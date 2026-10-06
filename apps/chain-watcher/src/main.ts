/**
 * Chain watcher. In sprint 8 (WA-804) it scans OrderPaid logs on Robinhood Chain from a saved block
 * cursor: every 3 s while a quote is open, every 5 minutes otherwise. Until then it only reports
 * that there is nothing to watch, so the workspace and its build are complete.
 */
process.stdout.write(
  `${JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'chain watcher: nothing to watch until payments ship (WA-804, sprint 8)' })}\n`,
);
