import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'

const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PlaygroundCredentials {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Write(ref Credential credential, uint flags);
 [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
 [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Delete(string target, uint type, uint flags);
 [DllImport("Advapi32.dll")] public static extern void CredFree(IntPtr credential);
}
'@
$inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = 'ModelPlayground/' + $inputValue.id
if ($inputValue.operation -eq 'write') {
 $bytes = [Text.Encoding]::Unicode.GetBytes($inputValue.value)
 $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
 try {
  [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $credential = New-Object PlaygroundCredentials+Credential
  $credential.Type=1; $credential.TargetName=$target; $credential.UserName='ModelPlayground'; $credential.Persist=2
  $credential.CredentialBlobSize=$bytes.Length; $credential.CredentialBlob=$ptr
  if (-not [PlaygroundCredentials]::Write([ref]$credential,0)) { throw 'Credential write failed' }
 } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
 '""'
} elseif ($inputValue.operation -eq 'read') {
 $ptr=[IntPtr]::Zero
 if ([PlaygroundCredentials]::Read($target,1,0,[ref]$ptr)) {
  try { $credential=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][PlaygroundCredentials+Credential]); [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob,$credential.CredentialBlobSize/2) | ConvertTo-Json -Compress }
  finally { [PlaygroundCredentials]::CredFree($ptr) }
 } elseif ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { '""' } else { throw 'Credential read failed' }
} else {
 if (-not [PlaygroundCredentials]::Delete($target,1,0) -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'Credential delete failed' }
 '""'
}
`
ipcMain.handle('playground:credential', async (event, input) => {
  if (event.senderFrame !== event.sender.mainFrame || !/^[\w-]{1,128}$/.test(input?.id) || !['read', 'write', 'delete'].includes(input?.operation)) throw new Error('Invalid credential request')
  if (process.platform !== 'win32') { if (input.operation === 'read' || input.operation === 'delete') return ''; throw new Error('记住 Key 当前仅支持 Windows') }
  if (typeof input.value === 'string' && input.value.length > 2000) throw new Error('Key too long')
  return new Promise<string>((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk })
    child.stderr.resume()
    const timer = setTimeout(() => { child.kill(); reject(new Error('系统凭据库超时')) }, 20000)
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法访问 Windows 凭据库')) })
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('无法读写 Windows 凭据库')); else { try { resolve(JSON.parse(output.trim())) } catch { reject(new Error('凭据库响应无效')) } } })
    child.stdin.end(JSON.stringify(input))
  })
})
