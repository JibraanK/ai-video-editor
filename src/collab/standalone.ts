import { randomBytes } from 'node:crypto'
import { startCollabServer } from './server'

const port = Number(process.env.PORT ?? 47822)
const adminToken = process.env.CUTLINE_ADMIN_TOKEN ?? randomBytes(16).toString('hex')

startCollabServer(port, adminToken).then(() => {
  console.log(`Cutline collab server on ws://0.0.0.0:${port}`)
  console.log(`Admin token (needed to create rooms): ${adminToken}`)
})
