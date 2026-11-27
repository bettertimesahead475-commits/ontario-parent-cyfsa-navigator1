import argparse
from contextlib import contextmanager, ExitStack
import hashlib
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PENDING = "supabase/migrations_pending_approval"
FILES = (
    "free_scan_reservation_functions.sql",
    "reconcile_skip_live_analyzer_jobs.sql",
    "free_scan_reservation_functions.down.sql",
    "reconcile_skip_live_analyzer_jobs.down.sql",
)
REVISIONS = {"audit": "08889700313907b7109e2f5bf6d64a59707617ed",
             "rc": "dd02ef34b862b89b0a755cf568ca9e18f2efa674"}
NOW = "'2026-11-27 16:00Z'"
OLD = f"{NOW}::timestamptz - interval '20 minutes'"
TYPES = {
    "free_marker_uid": "text,text",
    "free_release_marker": "text,text,timestamptz",
    "free_reconcile": "text,text,timestamptz,interval",
    "free_reserve_scan": "text,text,integer,timestamptz,interval",
    "free_finalize_scan": "text,text,timestamptz",
    "free_release_scan": "text,text,text,timestamptz",
    "paid_reconcile": "text,text,timestamptz,interval",
}
RPC_TYPES = {
    "free_reserve_scan": "text, text, integer, timestamp with time zone, interval",
    "free_finalize_scan": "text, text, timestamp with time zone",
    "free_release_scan": "text, text, text, timestamp with time zone",
    "paid_reserve_credit": "text, text, text, integer, timestamp with time zone, interval, interval",
    "paid_finalize_credit": "text, text, timestamp with time zone",
    "paid_release_credit": "text, text, text, timestamp with time zone",
}


def command(*args, data=None):
    p = subprocess.run(args, cwd=ROOT, input=data, capture_output=True, timeout=60)
    if p.returncode:
        raise RuntimeError(p.stderr.decode().strip() or " ".join(args))
    return p.stdout


def source(path, revision=None):
    return command("git", "show", f"{revision}:{path}") if revision else (ROOT / path).read_bytes()


def same(actual, expected):
    if actual != expected:
        raise AssertionError(f"expected {expected!r}; observed {actual!r}")


def free(uid, req, now=NOW, limit=3):
    return (f"public.free_reserve_scan(p_uid=>'{uid}',p_request=>'{req}',"
            f"p_limit=>{limit},p_now=>{now},p_ttl=>'15 minutes')")


def status(expr):
    return f"select ({expr})->>'status';"


def await_value(get, expected):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if get() == expected:
            return
        time.sleep(0.05)
    same(get(), expected)


class Database:
    def __init__(self, container, db):
        self.container, self.db = container, db

    def args(self):
        return ("docker", "exec", "-i", self.container, "psql", "-X", "-qAt",
                "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", self.db)

    def sql(self, sql, role=None):
        sql = sql.encode() if isinstance(sql, str) else sql
        prefix = f"set role {role};\n".encode() if role else b""
        return command(*self.args(), data=prefix + sql + b"\n").decode().strip()

    @contextmanager
    def session(self, sql):
        with subprocess.Popen(self.args(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True) as p:
            try:
                p.stdin.write(sql + "\n")
                p.stdin.flush()
                yield p
            finally:
                if p.poll() is None:
                    p.kill()

    def waiting(self, label, predicate):
        return self.sql(f"select count(*) from pg_stat_activity "
                        f"where application_name like '{label}' and {predicate};")

    def entitlement_rows(self):
        return self.sql("""
          select jsonb_agg(to_jsonb(s) order by id) from public.navigator_paid_sessions s;
          select jsonb_agg(to_jsonb(u) order by uid) from public.free_usage u
           where uid in ('qa-legacy','paid_session_10000000-0000-4000-8000-000000000001_total');
        """)

    def signatures_and_permissions(self, names):
        for name in names:
            fn = f"public.{name}({TYPES[name]})"
            self.sql(f"""
              DO $$ begin
                if (select prosecdef from pg_proc where oid = '{fn}'::regprocedure)
                  or has_function_privilege('anon','{fn}','EXECUTE')
                  or has_function_privilege('authenticated','{fn}','EXECUTE')
                  or not has_function_privilege('service_role','{fn}','EXECUTE')
                  or exists (select from pg_proc p, lateral aclexplode(p.proacl) a
                              where p.oid='{fn}'::regprocedure and a.grantee=0)
                then raise exception 'unexpected ACL or security mode for {fn}'; end if;
              end $$;
            """)
        same(self.sql("""
          select bool_and(relrowsecurity) from pg_class
           where oid in ('public.free_usage'::regclass,'public.analyzer_jobs'::regclass,
                         'public.navigator_paid_sessions'::regclass);
        """), "t")
        for role in ("anon", "authenticated"):
            for attempt in (status(free("qa-blocked", "request01")),
                            "select uid from public.free_usage;",
                            "select job_id from public.analyzer_jobs;"):
                try:
                    self.sql(attempt, role)
                except RuntimeError as exc:
                    if "permission denied" not in str(exc):
                        raise
                else:
                    raise AssertionError(f"{role} unexpectedly succeeded: {attempt}")

    def rpc_compatibility(self):
        for revision in ("b9617a8", "82dfe65", REVISIONS["rc"]):
            observed = {}
            analyze = source("functions/api/analyze.ts", revision).decode()
            for tier in ("free", "paid"):
                for kind in ("reservation", "lifecycle"):
                    path = f"functions/api/_{tier}-credit-{kind}.ts"
                    if f"./_{tier}-credit-{kind}" not in analyze:
                        raise AssertionError(f"{revision} analyze.ts does not import {path}")
                    for name, args in re.findall(r"rpc\('([^']+)',\s*\{([^}]+)\}", source(path, revision).decode()):
                        observed[name] = re.findall(r"\b(p_\w+)\s*:", args)
            same(set(observed), set(RPC_TYPES))
            for name, args in observed.items():
                same(self.sql(f"""
                    select array_to_string(proargnames,',') || ':' ||
                           oidvectortypes(proargtypes) || ':' || prorettype::regtype
                      from pg_proc where pronamespace='public'::regnamespace and proname='{name}';
                """), f"{','.join(args)}:{RPC_TYPES[name]}:jsonb")

    def free_lifecycle(self):
        def call(expr, expected):
            same(self.sql(status(expr), "service_role"), expected)
        uid = "qa-lifecycle"
        call(free(uid, "request01"), "reserved")
        call(free(uid, "request01"), "joined")
        call(f"public.free_finalize_scan('{uid}','request01',{NOW})", "consumed")
        call(free(uid, "request01"), "consumed")
        call(free(uid, "request02"), "reserved")
        release = (f"public.free_release_scan('{uid}','request02',"
                   f"public.free_marker_uid('{uid}','request02'),{NOW})")
        call(release, "released")
        call(release, "noop")
        same(self.sql(f"select analyses_used from public.free_usage where uid='{uid}';"), "1")

    def a_reclaim(self):
        same(self.sql(status(free("qa-a-expired", "request01", OLD)), "service_role"), "reserved")
        same(self.sql(status(free("qa-a-expired_extra", "request01", OLD)), "service_role"), "reserved")
        result = self.sql(status(free("qa-a-expired", "request02", limit=1)), "service_role")
        states = self.sql("""
          select email from free_usage where uid=free_marker_uid('qa-a-expired','request01');
          select email from free_usage where uid=free_marker_uid('qa-a-expired_extra','request01');
        """)
        same((result, states), ("reserved", "reservation:released\nreservation:reserved"))

    def b_scenario(self, tier, case, job, age, should_keep):
        uid = f"qa-b-{tier}-{case}"
        marker = f"public.{tier}_marker_uid('{uid}','request01')"
        if tier == "free":
            reserve = free(uid, "request01", OLD)
            counter = uid
        else:
            reserve = (f"public.paid_reserve_credit('{uid}','request01','total',3,"
                       f"{OLD},'15 minutes','60 seconds')")
            counter = f"paid_session_{uid}_total"
        same(self.sql(status(reserve), "service_role"), "reserved")
        if job:
            self.sql(f"""
              insert into public.analyzer_jobs(job_id,owner_uid,mode,status,input_key,reservation_id,updated_at)
              values ('{uid}','{uid}','full','{job}','synthetic',{marker},{NOW}::timestamptz - interval '{age}');
            """)
        self.sql(f"select public.{tier}_reconcile('{uid}','another',{NOW},'15 minutes');", "service_role")
        result = self.sql(f"""
          select email from public.free_usage where uid={marker};
          select analyses_used from public.free_usage where uid='{counter}';
        """)
        return result, "reservation:reserved\n1" if should_keep else "reservation:released\n0"

    def b_jobs(self, tier, keep):
        cases = ([("queued", "queued", "119 minutes"), ("running", "running", "119 minutes")] if keep else
                 [("boundary", "queued", "2 hours"), ("old", "running", "121 minutes"),
                  ("completed", "completed", "10 minutes"), ("failed", "failed", "10 minutes"),
                  ("absent", None, None)])
        results = [(case, *self.b_scenario(tier, case, job, age, keep)) for case, job, age in cases]
        same([(case, actual) for case, actual, _ in results], [(case, want) for case, _, want in results])

    def concurrent(self):
        uid = "qa-race"
        blocker = f"set application_name='ab-holder'; set role service_role; begin; {status(free(uid, 'request00'))}"
        with self.session(blocker) as holder:
            await_value(lambda: self.waiting("ab-holder", "state='idle in transaction'"), "1")
            with ExitStack() as stack:
                attempts = []
                for i in range(1, 7):
                    sql = f"set application_name='ab-contender-{i}'; set role service_role; {status(free(uid, f'request{i:02}'))}"
                    attempts.append(stack.enter_context(self.session(sql)))
                await_value(lambda: self.waiting("ab-contender-%", "wait_event_type='Lock' and wait_event='advisory'"), "6")
                same(holder.communicate("commit;\n", timeout=15), ("reserved\n", ""))
                outcomes = []
                for p in attempts:
                    out, err = p.communicate(timeout=15)
                    same((p.returncode, err), (0, ""))
                    outcomes.append(out.strip())
        same(sorted(outcomes), ["limit"] * 4 + ["reserved"] * 2)
        same(self.sql("""
          select analyses_used from free_usage where uid='qa-race';
          select count(*) from free_usage where left(uid, length('free_res_qa-race_'))='free_res_qa-race_';
        """), "3\n3")

    def interrupted(self):
        self.sql("""
          insert into free_usage(uid,analyses_used) values ('qa-interrupt',1);
          create function public.ab_pause_marker() returns trigger language plpgsql as $$
          begin
            if left(new.uid,length('free_res_qa-interrupt_'))='free_res_qa-interrupt_' then
              perform pg_sleep(60);
            end if;
            return new;
          end $$;
          create trigger ab_pause_marker before insert on free_usage
            for each row execute function public.ab_pause_marker();
        """)
        try:
            sql = "set application_name='ab-interrupted'; set role service_role; " + status(free("qa-interrupt", "request01"))
            with self.session(sql) as p:
                await_value(lambda: self.waiting("ab-interrupted", "wait_event='PgSleep'"), "1")
                same(self.sql("select pg_terminate_backend(pid) from pg_stat_activity where application_name='ab-interrupted';"), "t")
                out, err = p.communicate(timeout=15)
                same(out.strip(), "")
                if p.returncode == 0 or "terminating connection" not in err:
                    raise AssertionError(f"interrupted backend did not fail as expected: {err}")
        finally:
            self.sql("drop trigger ab_pause_marker on public.free_usage; drop function public.ab_pause_marker();")
        same(self.sql("""
          select analyses_used from free_usage where uid='qa-interrupt';
          select count(*) from free_usage where uid=free_marker_uid('qa-interrupt','request01');
        """), "1\n0")
        same(self.sql(status(free("qa-interrupt", "request01")), "service_role"), "reserved")

    def inventory(self):
        return self.sql("""
          select string_agg(md5(pg_get_functiondef(oid)) || ':' || proacl::text, ',' order by proname)
            from pg_proc where pronamespace='public'::regnamespace and proname ~ '^(free_|paid_)';
          select pg_get_indexdef('public.analyzer_jobs_live_reservation_idx'::regclass);
        """)

    def ledger(self):
        return self.sql("select md5(string_agg(to_jsonb(u)::text, ',' order by uid)) from free_usage u;")


def matrix(container, variant, collation, files):
    db = Database(container, "postgres")
    db_name = f"ab_{variant}_{'c' if collation == 'C' else 'en'}"
    db.sql(f"create database {db_name} template template0 locale '{collation}' locale_provider libc;")
    db = Database(container, db_name)
    locale = db.sql("select datcollate from pg_database where datname=current_database();")
    same(locale, collation)
    print(f"\n{variant} / {locale}", flush=True)
    a, b, a_down, b_down = files
    index = re.search(rb"(?m)^-- (create index concurrently[^\n]+)\n-- (  on [^\n]+;)", b)
    drop = re.search(rb"(?m)^-- Rollback: (drop index concurrently[^\n]+;)", b)
    if not index or not drop:
        raise AssertionError("B must document a standalone concurrent index create/drop")
    create_index, drop_index = b"\n".join(index.groups()), drop[1]
    for sql in (
        source("tests/devin/fixtures/live-nxfh-payment-schema.sql"),
        (HERE / "fixture.sql").read_bytes(),
        source("supabase/migrations/20261104230000_durable_analyzer_queue.sql"),
        source(f"{PENDING}/paid_credit_reservation_functions.sql"),
        source(f"{PENDING}/{FILES[0]}", REVISIONS["rc"]),
    ):
        db.sql(sql)

    expected_failures = ({"A reclaim", "B free reclaims non-live markers", "B down free reclaim"}
                         if variant == "rc" and collation != "C" else set())
    if expected_failures:
        expected_failures.add("Existing A SQL regression suite")
    failures = set()
    observed_regressions = set()

    def check(label, action):
        try:
            action()
        except (RuntimeError, AssertionError) as exc:
            failures.add(label)
            if isinstance(exc, AssertionError) and "observed" in str(exc) and "reservation:reserved" in str(exc):
                observed_regressions.add(label)
            if label == "Existing A SQL regression suite" and 'check 6c: expected reserved, got {"used": 3, "status": "limit"' in str(exc):
                observed_regressions.add(label)
            print(f"FAIL  {label}: {exc}", flush=True)
        else:
            print(f"PASS  {label}", flush=True)

    legacy = db.entitlement_rows()
    check("Old RPC contract on pre-A fixture", db.rpc_compatibility)
    check("Apply A", lambda: db.sql(a))
    check("A ACLs and fixture RLS", lambda: db.signatures_and_permissions(list(TYPES)[:-1]))
    check("A reserve/finalize/release", db.free_lifecycle)
    marker = "free_res_qa-collation_0123456789abcdef0123456789abcdef"
    print("INFO  Collation range probe: " + db.sql(f"""
      select '{marker}'::text collate "default" >= 'free_res_qa-collation_' and
             '{marker}'::text collate "default" < 'free_res_qa-collation`';
    """), flush=True)
    check("A reclaim", db.a_reclaim)
    check("Existing A SQL regression suite", lambda: same(
        db.sql(source(f"{PENDING}/free_scan_reservation_functions.test.sql")),
        "ALL FREE SCAN RESERVATION CHECKS PASSED"))

    def build_index():
        db.sql(create_index)
        same(db.sql("""
          select indisvalid and indisready
            and pg_get_indexdef(indexrelid, 1, false) = 'reservation_id'
            and pg_get_expr(indpred, indrelid) = '(status = ANY (ARRAY[''queued''::text, ''running''::text]))'
          from pg_index where indexrelid='public.analyzer_jobs_live_reservation_idx'::regclass;
        """), "t")

    check("Standalone concurrent partial index", build_index)
    check("Apply B", lambda: db.sql(b))
    check("A+B ACLs and fixture RLS", lambda: db.signatures_and_permissions(TYPES))
    check("Old and new RPC contracts on A+B", db.rpc_compatibility)
    check("Six verified simultaneous lock waits; free limit", db.concurrent)
    check("Interrupted reservation rolls back", db.interrupted)
    for tier in ("free", "paid"):
        check(f"B {tier} retains live queued/running markers", lambda: db.b_jobs(tier, True))
        check(f"B {tier} reclaims non-live markers", lambda: db.b_jobs(tier, False))

    applied = db.inventory()

    def forward():
        before_rows = db.ledger()
        db.sql(a)
        build_index()
        db.sql(b)
        same(db.inventory(), applied)
        same(db.entitlement_rows(), legacy)
        same(db.ledger(), before_rows)

    check("Reapply the full ordered package", forward)

    def remove_b():
        db.sql(b_down)
        db.sql(drop_index)
        same(db.sql("select to_regclass('public.analyzer_jobs_live_reservation_idx') is null;"), "t")
        same(db.sql("""select count(*) from pg_proc where pronamespace='public'::regnamespace
                        and proname in ('free_reconcile','paid_reconcile') and prosrc like '%analyzer_jobs%';"""), "0")
        db.rpc_compatibility()

    check("B down removes guard; separate concurrent index drop", remove_b)
    check("B down free reclaim", lambda: same(*db.b_scenario("free", "b-down", "queued", "30 minutes", False)))
    check("B down paid reclaim", lambda: same(*db.b_scenario("paid", "b-down", "queued", "30 minutes", False)))

    def repair():
        before_rows = db.ledger()
        db.sql(a_down)
        same(db.sql("""select count(*) from pg_proc where pronamespace='public'::regnamespace
                        and proname in ('free_reserve_scan','free_release_scan','free_finalize_scan',
                                        'free_release_marker','free_marker_uid','free_reconcile');"""), "0")
        forward()
        db.rpc_compatibility()
        same(db.ledger(), before_rows)

    check("A down drops RPCs; ordered forward repair preserves ledger", repair)
    check("Existing free and paid entitlements unchanged", lambda: same(db.entitlement_rows(), legacy))
    print(f"SUMMARY {variant} {collation}: {len(failures)} FAIL; "
          f"expected historical failures: {len(expected_failures)}", flush=True)
    return failures == expected_failures == observed_regressions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="postgres:17-bookworm")
    parser.add_argument("--variants", nargs="+", choices=["audit", "rc", "fixed"], default=["audit", "rc", "fixed"])
    options = parser.parse_args()
    variants = {}
    for variant in options.variants:
        variants[variant] = [source(f"{PENDING}/{name}", REVISIONS.get(variant)) for name in FILES]
        for name, sql in zip(FILES, variants[variant]):
            print(f"SHA256 {variant} {hashlib.sha256(sql).hexdigest()} {name}", flush=True)
    for path in (f"{PENDING}/free_scan_reservation_functions.test.sql",
                 f"{PENDING}/paid_credit_reservation_functions.sql",
                 "supabase/migrations/20261104230000_durable_analyzer_queue.sql",
                 "tests/devin/fixtures/live-nxfh-payment-schema.sql",
                 "engineering/qualification/ab/fixture.sql"):
        print(f"SHA256 fixture {hashlib.sha256(source(path)).hexdigest()} {path}", flush=True)

    container = f"ab-qualification-{uuid.uuid4().hex[:12]}"
    command("docker", "run", "-d", "--name", container, "--network", "none", "--rm",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", options.image)
    try:
        await_value(lambda: subprocess.run(
            ("docker", "exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"),
            capture_output=True, timeout=5).returncode, 0)
        print("Image " + command("docker", "image", "inspect", "--format", "{{index .RepoDigests 0}}", options.image).decode().strip())
        print(Database(container, "postgres").sql("show server_version;") + " (server_version)", flush=True)
        outcomes = [matrix(container, variant, locale, variants[variant])
                    for variant in options.variants for locale in ("C", "en_US.utf8")]
        return 0 if all(outcomes) else 1
    finally:
        command("docker", "stop", "-t", "1", container)


if __name__ == "__main__":
    raise SystemExit(main())
