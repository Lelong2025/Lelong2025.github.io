import { initMixingShell } from '../shared/shell.js'
import { initTapchiUi } from './ui.js'
import { initAccountEvents } from './account.js'
import { initSearchEvents, initApp } from './search.js'
import { initChatEvents } from './chat.js'

initMixingShell({ active: 'tapchi' })
initTapchiUi()
initAccountEvents()
initSearchEvents()
initChatEvents()
window.addEventListener('load', initApp)
