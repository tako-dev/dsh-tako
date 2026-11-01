#!/usr/bin/env node
/** Print capability evidence for recorded pricing JSON; no credentials or network calls. */
import { readFile } from 'node:fs/promises'
import { reasoningCapabilityReport } from '../lib/catalog.js'

const [directoryFile, optionsFile] = process.argv.slice(2)
if (!directoryFile) throw new Error('Usage: node scripts/reasoning-report.mjs <pricing.json> [catalog-options.json]')
const directory = JSON.parse(await readFile(directoryFile, 'utf8'))
if (!Array.isArray(directory.data)) throw new Error('pricing.json must contain a data array')
const options = optionsFile ? JSON.parse(await readFile(optionsFile, 'utf8')) : {}
const rows = reasoningCapabilityReport(directory.data, options)
console.log(JSON.stringify({ total: rows.length, unknown: rows.filter(row => row.source === 'unknown').length, models: rows }, null, 2))
