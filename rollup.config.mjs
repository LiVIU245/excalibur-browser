import dts from 'rollup-plugin-dts';
import esbuild from 'rollup-plugin-esbuild';

export default [
  {
    input: 'src/_module.ts',
    plugins: [esbuild()],
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