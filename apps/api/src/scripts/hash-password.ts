import { MIN_PASSWORD_LENGTH, hashPassword } from "../lib/password.js";

/**
 * `pnpm --filter @fabtyna/api hash-password`
 *
 * Interactive helper that turns a password you type into the Argon2id hash the
 * admin seed expects in `ADMIN_PASSWORD_HASH`.
 *
 * Safety rules this command guarantees:
 *   * it takes **no command-line arguments**, so the password can never end up
 *     in your shell history or in the process table;
 *   * it reads the password from a hidden prompt (nothing is echoed) and asks
 *     for it twice;
 *   * it never logs the password, and the only thing written to **stdout** is
 *     the finished hash — prompts and errors go to stderr.
 *
 * Because the prompt must suppress echo, the command refuses to run when stdin
 * is not an interactive terminal (e.g. a pipe or a redirected file).
 */

const stderr = process.stderr;

/** Reads one line from the terminal without echoing what is typed. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    if (stdin.isTTY !== true) {
      reject(new Error("this command needs an interactive terminal (stdin is not a TTY)."));
      return;
    }

    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    let inEscapeSequence = false;

    const stop = (settle: () => void): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stderr.write("\n");
      settle();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (inEscapeSequence) {
          // Swallow the rest of an ANSI escape sequence (arrow keys, Home, ...).
          if (/[A-Za-z~]/.test(char)) {
            inEscapeSequence = false;
          }
          continue;
        }
        if (char === "\u001b") {
          inEscapeSequence = true;
          continue;
        }
        if (char === "\u0003") {
          stop(() => reject(new Error("cancelled.")));
          return;
        }
        if (char === "\r" || char === "\n") {
          stop(() => resolve(value));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") {
          value += char;
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  if (process.argv.slice(2).length > 0) {
    throw new Error(
      "takes no arguments — you will be prompted for the password so it is never stored in your shell history or process list.",
    );
  }

  const password = await readHidden(`New password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  const confirmation = await readHidden("Confirm password: ");

  if (password !== confirmation) {
    throw new Error("the two passwords did not match. Nothing was printed.");
  }

  const stored = await hashPassword(password);
  process.stdout.write(`${stored}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`\nhash-password could not run: ${message}\n`);
  process.exitCode = 1;
});
