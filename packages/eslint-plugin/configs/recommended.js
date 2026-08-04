module.exports = {
  plugins: ['build-loop-eslint-plugin'],
  rules: {
    'build-loop-eslint-plugin/no-http-url': 'warn',
    'build-loop-eslint-plugin/no-secret-info': 'error',
  },
};
