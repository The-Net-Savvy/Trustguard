/** Plain form POST, so logout works without client-side JavaScript. */
export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Sign out
      </button>
    </form>
  );
}
