import { app } from 'electron'
import path from 'node:path'
app.setName('ModelPlayground')
if (process.env.CHATBOX_QA !== '1') app.setPath('userData', path.join(app.getPath('appData'), 'ModelPlayground'))
