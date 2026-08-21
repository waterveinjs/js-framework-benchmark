import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

const isProduction = process.env.production;

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/main.js',
    format: 'iife',
    name: 'app',
    sourcemap: !isProduction,
  },
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.DEV': JSON.stringify(false),
    }),
    nodeResolve({
      extensions: ['.js', '.ts', '.jsx', '.tsx'],
      browser: true
    }),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.ts', '.jsx', '.tsx'],
      presets: [
        ['@babel/preset-typescript'],
        ['babel-preset-solid', { generate: 'dom', hydratable: false }]
      ],
    }),
    isProduction && terser(),
  ],
};