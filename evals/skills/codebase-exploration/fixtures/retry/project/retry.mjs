export async function retry(operation, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
  }
}
