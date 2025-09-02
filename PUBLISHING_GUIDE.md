# NPM Publishing Guide for eGenome-Libs

This guide provides step-by-step instructions for publishing the eGenome-Libs package to the public NPM registry.

## Prerequisites

1. **NPM Account**: You need an NPM account. Create one at [npmjs.com](https://www.npmjs.com)
2. **NPM CLI**: Ensure npm is installed and up to date
3. **Repository Setup**: Your code should be in a Git repository
4. **Testing**: All tests should pass before publishing

## 1. Pre-Publishing Checklist

### Update Package Metadata

First, update the `package.json` with your actual repository information:

```bash
# Edit package.json and update these fields:
{
  "name": "@your-username/egenome-libs",  # For scoped packages (recommended)
  "version": "1.0.0",
  "repository": {
    "type": "git", 
    "url": "https://github.com/your-username/egenome-libs.git"
  },
  "bugs": {
    "url": "https://github.com/your-username/egenome-libs/issues"
  },
  "homepage": "https://github.com/your-username/egenome-libs#readme"
}
```

### Verify Build and Tests

```bash
# Build the package
npm run build

# Run all tests
npm test

# Run linting
npm run lint
```

### Update Documentation

Ensure your `README.md` includes:
- Clear installation instructions
- Usage examples
- API documentation
- Contribution guidelines

## 2. Authentication Setup

### Login to NPM

```bash
# Login to your NPM account
npm login

# Verify you're logged in
npm whoami
```

### Configure NPM (if using scoped packages)

```bash
# For scoped packages, ensure public access
npm config set access public
```

## 3. Version Management

### Semantic Versioning

This package uses semantic versioning (semver):
- **Patch** (1.0.1): Bug fixes
- **Minor** (1.1.0): New features (backward compatible)
- **Major** (2.0.0): Breaking changes

### Update Version

```bash
# For patch release (bug fixes)
npm version patch

# For minor release (new features)
npm version minor

# For major release (breaking changes)
npm version major

# Or manually specify version
npm version 1.2.3
```

## 4. Publishing Process

### Dry Run (Recommended First)

```bash
# Test what will be published without actually publishing
npm publish --dry-run
```

### Publish to NPM

```bash
# Publish the package
npm publish

# For scoped packages, ensure public access
npm publish --access public
```

### Verify Publication

```bash
# Check if your package is published
npm view egenome-libs

# Or for scoped packages
npm view @your-username/egenome-libs
```

## 5. Automated Publishing with Semantic Release

This package is configured with semantic-release for automated publishing. To use it:

### Setup GitHub Actions (Recommended)

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run build

  release:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Configure Secrets

In your GitHub repository settings, add:
1. `NPM_TOKEN`: Your NPM authentication token
2. `GITHUB_TOKEN`: Usually available by default

### Generate NPM Token

```bash
# Generate an NPM token for CI/CD
npm token create --read-only=false
```

## 6. Manual Publishing Steps

### Complete Manual Process

```bash
# 1. Ensure clean working directory
git status

# 2. Pull latest changes
git pull origin main

# 3. Run tests and build
npm test && npm run build

# 4. Update version
npm version patch  # or minor/major

# 5. Push version commit and tag
git push origin main --tags

# 6. Publish to NPM
npm publish

# 7. Create GitHub release (optional)
gh release create v$(node -p "require('./package.json').version") \
  --title "Release v$(node -p "require('./package.json').version")" \
  --notes "Release notes here"
```

## 7. Post-Publishing

### Verify Installation

Test that users can install your package:

```bash
# Test installation in a new directory
mkdir test-install && cd test-install
npm init -y
npm install egenome-libs
# Or: npm install @your-username/egenome-libs

# Test import
node -e "console.log(require('egenome-libs'))"
```

### Update Documentation

Update any documentation that references the package name or installation instructions.

## 8. Package Features Summary

Your published package includes:

### Core Features
- ✅ **TypeScript Support**: Full type definitions included
- ✅ **ESM + CJS**: Dual module format support
- ✅ **Dependency Injection**: Inversify-based DI container
- ✅ **Multiple Stores**: Memory, Redis, Multi-tier caching
- ✅ **Advanced Caching**: TTL, LRU, batch operations
- ✅ **Error Handling**: Result type pattern
- ✅ **Configuration**: Type-safe configuration management

### Installation for Users

```bash
# Install the package
npm install egenome-libs

# Install optional dependencies for Redis support
npm install ioredis

# Install peer dependencies for DI
npm install inversify reflect-metadata
```

### Basic Usage Example

```typescript
import { 
  DIContainer, 
  StoreFactory, 
  StoreType, 
  cacheItem 
} from 'egenome-libs';

// Get DI container
const container = DIContainer.getInstance();

// Create stores using factory
const storeFactory = container.get<StoreFactory>('StoreFactory');
const cache = storeFactory.createStore({ type: StoreType.ENHANCED_MEMORY });

// Use caching
const result = await cacheItem({
  store: cache,
  key: 'user:123',
  fetcher: () => fetchUserFromAPI('123'),
  options: { ttlMs: 300000 }
});
```

## 9. Troubleshooting

### Common Issues

1. **Authentication Error**: Run `npm login` again
2. **Package Name Taken**: Use a scoped package `@username/package-name`
3. **Version Already Exists**: Update version number with `npm version`
4. **Build Errors**: Ensure `npm run build` passes before publishing

### Support

- Check NPM documentation: [docs.npmjs.com](https://docs.npmjs.com)
- Semantic Release: [semantic-release.gitbook.io](https://semantic-release.gitbook.io)
- GitHub Actions: [docs.github.com/actions](https://docs.github.com/en/actions)

## 10. Maintenance

### Regular Updates

- Keep dependencies updated
- Monitor for security vulnerabilities: `npm audit`
- Update documentation as features evolve
- Maintain backward compatibility when possible

### Deprecation

If you need to deprecate a version:

```bash
npm deprecate egenome-libs@1.0.0 "This version has been deprecated"
```

---

**Ready to publish?** Follow the steps above and your eGenome-Libs package will be available for the global NPM community! 🚀
