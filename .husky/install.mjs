// Husky is a dev dependency; skip hook setup in production-only installs.
try {
  const { default: husky } = await import('husky')
  console.log(husky())
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err
}
