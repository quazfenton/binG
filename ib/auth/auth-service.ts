/* Minimal mock auth/account service for binG (localStorage-based) */

const STORAGE = 'binG:accounts_v1'

export type Account = { username: string; passwordHash: string; createdAt: string; id: string; meta?: any }

function readAll(): Account[] {
  return JSON.parse(localStorage.getItem(STORAGE) || '[]') as Account[]
}
function writeAll(all: Account[]) {
  localStorage.setItem(STORAGE, JSON.stringify(all))
}

export function registerAccount(username: string, password: string) {
  const all = readAll()
  if (all.find((a) => a.username === username)) throw new Error('user exists')
  const acc: Account = { username, passwordHash: btoa(password), createdAt: new Date().toISOString(), id: `u_${Date.now()}` }
  all.push(acc)
  writeAll(all)
  localStorage.setItem('binG:current_user', acc.id)
  return acc
}

export function login(username: string, password: string) {
  const all = readAll()
  const acc = all.find((a) => a.username === username && a.passwordHash === btoa(password))
  if (!acc) throw new Error('invalid')
  localStorage.setItem('binG:current_user', acc.id)
  return acc
}

export function currentUser() {
  const id = localStorage.getItem('binG:current_user')
  const all = readAll()
  return all.find((a) => a.id === id) ?? null
}