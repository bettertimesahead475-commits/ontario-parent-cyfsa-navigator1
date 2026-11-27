#!/usr/bin/env python3
import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile


FILES = ("database.dump", "schema.sql", "tables.json", "manifest.json")
NAME = r"[a-z_][a-z0-9_]{0,62}"
SCRATCH = r"recovery_scratch_[a-z0-9_]{1,45}"
READ_ONLY = " -c default_transaction_read_only=on"
OPTIONS = (
    "-c search_path=pg_catalog -c row_security=off -c lock_timeout=5000"
    " -c TimeZone=UTC -c DateStyle=ISO,YMD -c IntervalStyle=postgres"
    " -c extra_float_digits=3 -c bytea_output=hex"
)
PSQL = ("psql", "-X", "-qAtw", "-v", "ON_ERROR_STOP=1")
IDENTITY = """
select json_build_object(
  'database', current_database(), 'role', current_user, 'address', inet_server_addr(),
  'port', inet_server_port(), 'server_version_num', current_setting('server_version_num'),
  'encoding', current_setting('server_encoding'), 'in_recovery', pg_is_in_recovery(),
  'transaction_read_only', current_setting('transaction_read_only'),
  'lsn_at_observation', case when pg_is_in_recovery() then pg_last_wal_replay_lsn()
                              else pg_current_wal_lsn() end,
  'extensions', (select json_agg(json_build_array(extname, extversion) order by extname)
                 from pg_extension),
  'roles', (select json_agg(json_build_array(rolname, rolcanlogin, rolbypassrls, rolsuper) order by rolname)
            from pg_roles where rolname not like 'pg\\_%'),
  'foreign_tables', (select count(*) from pg_foreign_table),
  'observed_at', clock_timestamp()
);
"""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def sql(statement, env):
    return run([*PSQL, "-c", statement], env=env, stdout=subprocess.PIPE, text=True).stdout.strip()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def connection(args):
    env = dict(os.environ)
    for key in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS"):
        require(not env.get(key), f"Unset {key}; implicit libpq routing/options are not allowed.")
    host, port, db, user = (env.get(k, "") for k in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER"))
    require(re.fullmatch(NAME, db) and re.fullmatch(NAME, user), "Set explicit, simple PGDATABASE and PGUSER names.")
    require(re.fullmatch(r"[0-9]{1,5}", port) and 0 < int(port) < 65536, "Set explicit PGPORT.")
    if args.project_ref:
        require(args.action != "restore", "Remote restore is prohibited.")
        require(re.fullmatch(r"[a-z0-9]{20}", args.project_ref), "Invalid Supabase project ref.")
        require(host == f"db.{args.project_ref}.supabase.co" and port == "5432"
                and env.get("PGSSLMODE") == "verify-full", "Require the verified direct Supabase endpoint and TLS verify-full.")
        env["PGGSSENCMODE"] = "disable"
    else:
        require(re.fullmatch(r"/[A-Za-z0-9_./-]+", host), "Default requires an explicit local Unix socket directory.")
        prefix = SCRATCH if args.action == "restore" else r"recovery_source_[a-z0-9_]{1,45}"
        require(re.fullmatch(prefix, db), "Require a disposable recovery_source_* or recovery_scratch_* database.")
    env.update(PGOPTIONS=OPTIONS + READ_ONLY, PGCLIENTENCODING="UTF8", PGCONNECT_TIMEOUT="8")
    return env


def identity(env, args):
    result = json.loads(sql(IDENTITY, env))
    require(result["database"] == env["PGDATABASE"] and result["role"] == env["PGUSER"]
            and result["transaction_read_only"] == "on" and not result["in_recovery"],
            "Unexpected database, role, or primary/read-only session state.")
    if not args.project_ref:
        require(result["address"] is None and result["port"] is None, "Server did not accept a Unix socket connection.")
    return result


def client_version(tool, expected_major):
    version = run([tool, "--version"], stdout=subprocess.PIPE, text=True).stdout.strip()
    require(re.search(r"\) " + str(expected_major) + r"\.", version), f"{tool} major must match server major {expected_major}.")
    return version


@contextlib.contextmanager
def snapshot(env):
    with subprocess.Popen(PSQL, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as keeper:
        try:
            keeper.stdin.write("begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n")
            keeper.stdin.flush()
            token = keeper.stdout.readline().strip()
            require(re.fullmatch(r"[0-9A-F-]+", token), "Failed to export a PostgreSQL snapshot.")
            yield token
            keeper.stdin.write("rollback;\n")
            keeper.stdin.close()
            require(keeper.wait() == 0, "Snapshot keeper failed.")
        finally:
            if keeper.poll() is None:
                keeper.terminate()


def table_fingerprints(env, schemas, token):
    scope = ", ".join(f"'{name}'" for name in schemas)
    statement = rf"""
begin isolation level repeatable read read only;
set transaction snapshot '{token}';
select case c.relkind
    when 'S' then format(
      'select %L, %L, %L; select last_value::text || '':'' || is_called::text from %I.%I;',
      'sequence', n.nspname, c.relname, n.nspname, c.relname)
    else format(
      'select %L, %L, %L; select encode(sha256(convert_to(row_to_json(t)::text, ''UTF8'')), ''hex'')
          collate "C" as digest from only %I.%I t order by digest;',
      'table', n.nspname, c.relname, n.nspname, c.relname)
    end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ({scope}) and c.relkind in ('r', 'S')
 order by n.nspname collate "C", c.relname collate "C"
\gexec
rollback;
"""
    results = []
    with subprocess.Popen(PSQL + ("-z", "-0"), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as proc:
        try:
            proc.stdin.write(statement.encode())
            proc.stdin.close()
            fields = []
            pending = b""
            current = None
            for chunk in iter(lambda: proc.stdout.read(65536), b""):
                *values, pending = (pending + chunk).split(b"\0")
                for value in values:
                    if fields or value in (b"table", b"sequence"):
                        fields.append(value)
                        if len(fields) == 3:
                            if current is not None:
                                current["sha256"] = hasher.hexdigest()
                            kind, schema, name = (f.decode() for f in fields)
                            current = {"kind": kind, "schema": schema, "name": name, "count": 0}
                            results.append(current)
                            hasher = hashlib.sha256()
                            fields.clear()
                    else:
                        require(current is not None and re.fullmatch(rb"[0-9a-f]{64}|-?[0-9]+:(true|false)", value),
                                "Unexpected table fingerprint data.")
                        current["count"] += 1
                        hasher.update(value + b"\n")
            if current is not None:
                current["sha256"] = hasher.hexdigest()
            require(proc.wait() == 0 and not fields and not pending, "Table fingerprint query failed.")
        finally:
            if proc.poll() is None:
                proc.terminate()
    return results


def dump(env, schemas, token, directory, restrict_key, include_data):
    flags = ["pg_dump", "--no-password", "--strict-names", "--no-large-objects", "--snapshot=" + token]
    flags += ["--schema=" + name for name in schemas]
    if include_data:
        with (directory / FILES[0]).open("wb") as out:
            run([*flags, "--format=custom"], env=env, stdout=out)
    schema = directory / FILES[1]
    with schema.open("wb") as out:
        run([*flags, "--schema-only", "--restrict-key=" + restrict_key], env=env, stdout=out)


def migration(args):
    return {"version": args.version, "file": args.migration.name, "sha256": digest(args.migration)}


def backup(args, env, server, directory):
    schemas = sorted(set(args.schema))
    major = int(server["server_version_num"]) // 10000
    version = client_version("pg_dump", major)
    require(re.fullmatch(r"[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64}", args.recipient), "Provide the approved full GPG key fingerprint.")
    restrict_key = secrets.token_hex(32)
    with snapshot(env) as token:
        dump(env, schemas, token, directory, restrict_key, include_data=True)
        write_json(directory / FILES[2], table_fingerprints(env, schemas, token))
    write_json(directory / FILES[3], {
        "format": 1, "server": server, "pg_dump": version, "major": major, "schemas": schemas,
        "source_host": env["PGHOST"], "project_ref": args.project_ref, "migration": migration(args),
        "restrict_key": restrict_key,
        "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sha256": {name: digest(directory / name) for name in FILES[:3]},
    })
    plain = directory / "bundle.zip"
    with zipfile.ZipFile(plain, "w") as bundle:
        for name in FILES:
            bundle.write(directory / name, name)
    with tempfile.NamedTemporaryFile(dir=args.artifact.parent, prefix=".recovery-") as encrypted:
        run(["gpg", "--batch", "--no-tty", "--trust-model", "always",
             "--recipient", args.recipient, "--output", "-", "--encrypt", str(plain)], stdout=encrypted)
        checksum = digest(Path(encrypted.name))
        require(os.stat(encrypted.name).st_size > 0, "Empty encrypted artifact.")
        os.link(encrypted.name, args.artifact)
    print(f"Backup ciphertext SHA-256: {checksum}")


def restore(args, env, directory):
    require(re.fullmatch(r"[0-9a-f]{64}", args.artifact_sha256), "Supply the trusted ciphertext SHA-256.")
    encrypted = directory / "bundle.gpg"
    with args.artifact.open("rb") as source, encrypted.open("wb") as target:
        shutil.copyfileobj(source, target)
    require(digest(encrypted) == args.artifact_sha256, "Encrypted artifact SHA-256 mismatch.")
    plain = directory / "bundle.zip"
    with plain.open("wb") as out:
        run(["gpg", "--no-tty", "--decrypt", str(encrypted)], stdout=out)
    with zipfile.ZipFile(plain) as bundle:
        require(sorted(bundle.namelist()) == sorted(FILES), "Unexpected backup file set.")
        for name in FILES:
            bundle.extract(name, directory)
    manifest = json.loads((directory / FILES[3]).read_text())
    require(manifest["format"] == 1 and manifest["migration"] == migration(args), "Backup migration identity mismatch.")
    for name in FILES[:3]:
        require(digest(directory / name) == manifest["sha256"][name], f"{name} SHA-256 mismatch.")
    schemas = manifest["schemas"]
    require(schemas and all(re.fullmatch(NAME, name) for name in schemas), "Invalid backup schema scope.")
    restrict_key = manifest["restrict_key"]
    require(re.fullmatch(r"[0-9a-f]{64}", restrict_key), "Invalid schema dump restrict key.")
    maintenance = dict(env, PGDATABASE="postgres")
    server = identity(maintenance, args)
    major = int(server["server_version_num"]) // 10000
    require(major == manifest["major"], "Scratch server major differs from source.")
    require(client_version("pg_dump", major) == manifest["pg_dump"], "Use the same pg_dump build as the backup.")
    client_version("pg_restore", major)
    write = dict(maintenance, PGOPTIONS=OPTIONS)
    db = env["PGDATABASE"]
    sql(f'create database "{db}" template template0', write)
    archive = directory / FILES[0]
    listing = run(["pg_restore", "--list", str(archive)], stdout=subprocess.PIPE, text=True).stdout
    # public already exists in template0. pg_dump's public ACL is relative to that initial namespace.
    toc = "\n".join(line for line in listing.splitlines()
                    if not re.match(r"^\d+; \d+ \d+ SCHEMA - public ", line))
    run(["pg_restore", "--no-password", "--exit-on-error", "--single-transaction", "--use-list=/dev/stdin",
         "--dbname=" + db, str(archive)], input=toc + "\n", text=True, env=write)
    expected = json.loads((directory / FILES[2]).read_text())
    with snapshot(env) as token:
        require(table_fingerprints(env, schemas, token) == expected, "Restored table or sequence fingerprints differ.")
        expected_schema = digest(directory / FILES[1])
        dump(env, schemas, token, directory, restrict_key, include_data=False)
        require(digest(directory / FILES[1]) == expected_schema, "Restored schema SQL differs.")
    print("Scratch restore verified: schema SQL, per-table counts and SHA-256, sequence states.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("preflight", "backup", "restore"))
    parser.add_argument("--project-ref", help="Explicit read-only direct Supabase source; never accepted for restore.")
    parser.add_argument("--local", action="store_true", help="Confirm a disposable local socket inside an isolated cluster.")
    parser.add_argument("--version", required=True, help="Exact approved database migration version.")
    parser.add_argument("--migration", type=Path, required=True)
    parser.add_argument("--schema", action="append", default=[])
    parser.add_argument("--work-dir", type=Path, help="Existing encrypted private volume for plaintext staging.")
    parser.add_argument("--artifact", type=Path, help="Encrypted backup path.")
    parser.add_argument("--artifact-sha256", help="Expected ciphertext hash from the trusted release record.")
    parser.add_argument("--recipient", help="Approved GPG recipient fingerprint.")
    args = parser.parse_args()
    require(args.local != bool(args.project_ref), "Specify exactly one of --local or --project-ref.")
    require(re.fullmatch(r"[0-9]{8,14}", args.version), "Specify the approved numeric migration version.")
    metadata = migration(args)
    env = connection(args)
    if args.action == "preflight":
        print(json.dumps({"server": identity(env, args), "migration": metadata}, indent=2))
    else:
        require(args.work_dir and args.work_dir.is_absolute() and args.work_dir.is_dir() and args.artifact,
                "Specify the absolute private encrypted --work-dir and the --artifact path.")
        require((args.work_dir.stat().st_mode & 0o077) == 0 and args.work_dir.stat().st_uid == os.getuid(),
                "Plaintext staging directory must be private and owned by the invoking account.")
        os.umask(0o077)
        with tempfile.TemporaryDirectory(dir=args.work_dir, prefix="recovery-") as temp:
            directory = Path(temp)
            if args.action == "backup":
                require(args.schema and all(re.fullmatch(NAME, name) for name in args.schema),
                        "Specify the approved scope as one or more --schema names.")
                require(args.recipient and not args.artifact.exists(), "Require a recipient and a new artifact path.")
                backup(args, env, identity(env, args), directory)
            else:
                require(args.artifact_sha256 and not args.schema, "Require --artifact-sha256; scope is read from the backup.")
                restore(args, env, directory)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        sys.exit(f"Recovery stopped: {exc}")
