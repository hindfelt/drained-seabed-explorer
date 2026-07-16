const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry(fn, { attempts = 3, delayMs = 2000, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
