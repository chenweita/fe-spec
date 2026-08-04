'use strict';

const rule = require('../../rules/no-http-url');
const { RuleTester } = require('eslint');

const ruleTester = new RuleTester();

ruleTester.run('no-http-url', rule, {
  valid: [
    {
      code: "var test = 'https://huahua.com';",
    },
  ],

  invalid: [
    {
      code: "var test = 'http://huahua.com';",
      output: "var test = 'http://huahua.com';",
      errors: [
        {
          message: 'Recommended "http://huahua.com" switch to HTTPS',
        },
      ],
    },
    {
      code: "<img src='http://huahua.com' />",
      output: "<img src='http://huahua.com' />",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      errors: [
        {
          message: 'Recommended "http://huahua.com" switch to HTTPS',
        },
      ],
    },
  ],
});
