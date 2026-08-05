module.exports = {
  plugins: ['@buildloop/eslint-plugin'],
  rules: {
    '@buildloop/eslint-plugin/no-http-url': 'warn',
    '@buildloop/eslint-plugin/no-secret-info': 'error',
  },
};
