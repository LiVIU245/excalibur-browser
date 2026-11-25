import dts from 'rollup-plugin-dts';
import { readFileSync } from 'node:fs';
import esbuild from 'rollup-plugin-esbuild';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default [
  {
    input: 'src/_module.ts',
    plugins: [esbuild({ define: { __SDK_VERSION__: JSON.stringify(version) } })],
    output: [
      {
        file: 'dist/cjs/index.cjs',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/esm/index.mjs',
        format: 'es',
        sourcemap: true,
      },
    ],
  },
  {
    input: 'src/_module.ts',
    plugins: [dts()],
    output: {
      file: 'dist/types/index.d.ts',
      format: 'es',
    },
  },
];