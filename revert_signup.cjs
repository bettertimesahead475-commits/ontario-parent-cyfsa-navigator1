const fs = require('fs');

let code = fs.readFileSync('src/components/SignUpTab.tsx', 'utf-8');

code = code.replace(/const handleLogout = \(\) => \{\n\s*if \(\!logoutConfirm\) \{\n\s*setLogoutConfirm\(true\);\n\s*setTimeout\(\(\) => setLogoutConfirm\(false\), 3000\);\n\s*return;\n\s*\}\n\s*setLogoutConfirm\(false\);\n\s*resetAll\(\);\n\s*\};/,
`const handleLogout = () => {
    if (!logoutConfirm) {
      setLogoutConfirm(true);
      setTimeout(() => setLogoutConfirm(false), 3000);
      return;
    }
    setLogoutConfirm(false);
    try {
      localStorage.removeItem("OPA_USER_PROFILE");
      setProfile(null);
      setRegistrationSuccess(false);
      // Reset form
      setFullName("");
      setEmail("");
      setPasscode("");
      window.dispatchEvent(new CustomEvent("opa-user-profile-updated"));
    } catch (e) {
      console.warn(e);
    }
  };`);

fs.writeFileSync('src/components/SignUpTab.tsx', code);
