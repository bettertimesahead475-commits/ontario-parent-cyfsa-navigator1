# Facebook Page connection — Meta setup

This is the configuration the owner completes in Meta's developer console, and
the values that go into Vercel. Derived from the code in
`api/services/marketing/facebookOAuth.ts` and `routes.ts`. Nothing here is
invented: each URL and name comes from those files.

## 1. Meta app

1. Open https://developers.facebook.com/apps and create an app, type **Business**
   (or use an existing app you own). Do not reuse the Navigator One app.
2. Add the product **Facebook Login** (the classic Facebook Login product, which
   this code uses for the OAuth dialog). Set the app to **Development** mode
   while testing.
3. Under **Facebook Login → Settings**, add this to **Valid OAuth Redirect URIs**
   (exact, including https and no trailing slash):

   ```
   https://cyfsanavigator.com/api/admin/marketing/facebook/callback
   ```

4. Under **App settings → Basic**, copy the **App ID** and **App Secret**. The
   secret is server-only.
5. Add the owner's Facebook account as an **Administrator** or **Developer** of the
   app, or as a **Tester**. In Development mode only those roles can complete
   the connection.

## 2. Permissions

| Permission | Why it is requested |
|---|---|
| `pages_show_list` | list the Pages the owner manages |
| `pages_manage_posts` | publish and schedule posts on a Page |
| `pages_read_engagement` | read post engagement counts |

**App Review:** Meta requires App Review (Advanced Access) before these permissions
work for accounts that are not app roles. Advanced Access also requires Business
Verification. Confirm the current requirements in Meta's App Review documentation
before submitting; this document does not assert Meta's current policy.

**Development mode:** the full flow can be tested with the owner's real Page, using
an account that holds an app role on the app.

## 3. Environment variables (Vercel, Production and Preview)

| Name | Value | Visible to browser? |
|---|---|---|
| `META_APP_ID` | App ID | no (server only) |
| `META_APP_SECRET` | App Secret | **never** |
| `MARKETING_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` | **never** |
| `APP_PUBLIC_URL` | `https://cyfsanavigator.com` (optional; this is the default) | no |
| `META_GRAPH_VERSION` | Graph API version (optional; default `v21.0`, confirm before release) | no |
| `ADMIN_SECRET` | existing; required for the admin console | **never** |

Do not add any of these with a `VITE_` or `NEXT_PUBLIC_` prefix. Those prefixes
expose values in the browser bundle.

## 4. Connecting the Page (owner steps)

1. Open `/admin/marketing`, Channels tab, **Facebook Page** card.
2. Click **Connect Facebook Page**. Approve the three permissions on Facebook.
3. Return to the console and choose the Page. Choosing it stores the Page token
   encrypted and shows the Page name.
4. To remove the connection, click **Disconnect Page**. Posts already published
   stay on Facebook.

## 5. Failure states the console shows

- **Reconnect required:** Facebook rejected the stored token (for example, the
  password was changed or the permission was removed). Publishing stops for
  Facebook until you reconnect. Scheduled posts stay scheduled.
- **Not connected:** nothing is stored. Scheduled Facebook posts wait and are not
  marked failed.

## 6. Webhooks

None are required. This integration polls the Graph API on demand and records
results. Do not configure a webhook callback URL for this feature.
