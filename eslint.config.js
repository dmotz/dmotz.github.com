import globals from 'globals'
import pluginJs from '@eslint/js'
import svelte from 'eslint-plugin-svelte'

export default [
  {languageOptions: {globals: {...globals.browser, process: true}}},
  pluginJs.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    rules: {
      'array-callback-return': 'error',
      'arrow-body-style': 'error',
      camelcase: 'error',
      curly: 'error',
      'dot-notation': 'error',
      eqeqeq: 'error',
      'no-delete-var': 'error',
      'no-duplicate-imports': 'error',
      'no-else-return': 'error',
      'no-extra-boolean-cast': 'error',
      'no-labels': 'error',
      'no-lonely-if': 'error',
      'no-multi-str': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'no-undef-init': 'error',
      'no-undefined': 'error',
      'no-unneeded-ternary': 'error',
      'no-unreachable-loop': 'error',
      'no-unused-expressions': 'error',
      'no-use-before-define': ['error', {variables: false}],
      'no-useless-assignment': 'error',
      'no-useless-call': 'error',
      'no-useless-catch': 'error',
      'no-useless-concat': 'error',
      'no-useless-constructor': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'no-with': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'prefer-exponentiation-operator': 'error',
      'prefer-object-spread': 'error',
      'prefer-regex-literals': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'require-await': 'error',
      'require-atomic-updates': 'error'
    }
  }
]
