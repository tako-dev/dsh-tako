#!/usr/bin/env node
/** `dsh-tako` executable. */
import { main } from './cli.ts'

const code = await main(process.argv.slice(2), {
  stdout: text => { process.stdout.write(text) },
  stderr: text => { process.stderr.write(text) },
  env: process.env,
})
process.exitCode = code
