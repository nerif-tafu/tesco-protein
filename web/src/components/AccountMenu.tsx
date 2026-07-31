import { useAuth } from "../lib/auth-context";
import { useStars } from "../lib/stars-context";

export default function AccountMenu() {
  const { status, account, error, signIn, signOut } = useAuth();
  const { status: syncStatus, count } = useStars();

  if (status === "loading") {
    return <div className="account muted-sm">Checking sign-in…</div>;
  }

  if (status === "unconfigured") {
    return (
      <div className="account">
        <span
          className="muted-sm"
          title="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server"
        >
          Google sign-in off
        </span>
      </div>
    );
  }

  if (status === "signed-in" && account) {
    return (
      <div className="account">
        {account.picture && (
          <img className="avatar" src={account.picture} alt="" width={28} height={28} />
        )}
        <div className="account-copy">
          <strong>{account.name ?? account.email ?? "Signed in"}</strong>
          <span className={`sync sync-${syncStatus}`}>{syncCopy(syncStatus, count)}</span>
        </div>
        <button type="button" className="chip small" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="account">
      <button type="button" className="chip google" onClick={() => signIn()}>
        <GoogleMark />
        Sign in with Google
      </button>
      {error && <span className="muted-sm">{error}</span>}
    </div>
  );
}

function syncCopy(status: string, count: number): string {
  switch (status) {
    case "syncing":
      return "Syncing your stars…";
    case "synced":
      return `${count} starred`;
    case "error":
      return "Could not sync stars";
    default:
      return `${count} starred`;
  }
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
