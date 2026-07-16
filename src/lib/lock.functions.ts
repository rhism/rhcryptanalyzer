import { createServerFn } from "@tanstack/react-start";

export const verifyPin = createServerFn({ method: "POST" })
  .inputValidator((input: { pin: string }) => {
    if (!input || typeof input.pin !== "string") throw new Error("Invalid input");
    return { pin: input.pin };
  })
  .handler(async ({ data }) => {
    const expected = process.env.APP_LOCK_PIN;
    if (!expected) throw new Error("APP_LOCK_PIN belum di-set di server secrets.");
    const a = data.pin;
    const b = expected;
    // constant-time-ish compare
    let ok = a.length === b.length;
    const len = Math.max(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < len; i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    if (diff !== 0) ok = false;
    return { ok };
  });
