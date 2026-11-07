function readPackage(pkg) {
  if (pkg.name === 'concurrently') {
    pkg.dependencies = { ...pkg.dependencies, 'shell-quote': '^1.9.0' };
  }

  if (pkg.name === 'query-string') {
    pkg.dependencies = { ...pkg.dependencies, 'decode-uri-component': '^0.5.1' };
  }

  if (pkg.name === '@expo/cli') {
    pkg.dependencies = { ...pkg.dependencies, zod: '^4.6.6' };
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
