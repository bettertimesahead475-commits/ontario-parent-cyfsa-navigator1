/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-time, per-browser-profile notice shown after signing in for the first time post-launch
 * of account isolation, if old un-namespaced data is sitting in this browser. Per the agreed
 * design: this data is NEVER silently assigned to whoever happens to sign in first - on a
 * shared computer there's no way to know whose it actually was, and guessing would recreate
 * exactly the privacy problem this whole change exists to fix. The old keys are left on disk
 * untouched (not deleted) so a second person signing in on the same machine gets the same
 * notice and the same chance to notice/preserve it before it's gone for good.
 */
import { shouldShowMigrationNotice, markMigrationNoticeSeen } from "../utils/storage";
import { useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function MigrationNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldShowMigrationNotice());
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    markMigrationNoticeSeen();
    setVisible(false);
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-900 flex-1">
          We found saved work on this device from before accounts were required. We can't tell
          whose it was, so it hasn't been added to your account automatically. If you need it,
          open the relevant tab and use its Export/Print option before it's cleared - dismissing
          this message will not delete anything, but it also won't be shown again on this device.
        </p>
        <button onClick={dismiss} className="text-amber-500 hover:text-amber-700 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
