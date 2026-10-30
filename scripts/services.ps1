param([ValidateSet('Start','Stop','Restart','Status')][string]$Action='Start')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$nodeExecutable=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$serviceDefinitions=@(
 @{Name='business';Port=3181;Entry='apps\business\server.ts';Health='http://127.0.0.1:3181/health'},
 @{Name='agent';Port=3180;Entry='apps\agent\server.ts';Health='http://127.0.0.1:3180/api/health'},
 @{Name='web';Port=5180;Entry='apps\web\vite.config.ts';Health='http://127.0.0.1:5180/admin'}
)
New-Item -ItemType Directory -Path (Join-Path $taskRoot '.local\logs') -Force | Out-Null
function Get-ServiceOwner($definition){
 $listener=Get-NetTCPConnection -State Listen -LocalPort $definition.Port -ErrorAction SilentlyContinue | Select-Object -First 1
 if(!$listener){return $null}
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
 if($process.CommandLine -notlike "*$taskRoot*"){throw "Port $($definition.Port) belongs to a different process; leave it unchanged."}
 return $process
}
if($Action -in @('Stop','Restart')){foreach($definition in $serviceDefinitions[2..0]){$process=Get-ServiceOwner $definition;if($process){Stop-Process -Id $process.ProcessId;Write-Output "$($definition.Name) stopped"}}}
if($Action -in @('Start','Restart')){
 foreach($definition in $serviceDefinitions){
  $process=Get-ServiceOwner $definition
  if(!$process){
   if($definition.Name -eq 'web'){$arguments=@((Join-Path $taskRoot 'node_modules\vite\bin\vite.js'),'--config',(Join-Path $taskRoot $definition.Entry))}
   else{$arguments=@((Join-Path $taskRoot 'node_modules\tsx\dist\cli.mjs'),(Join-Path $taskRoot $definition.Entry))}
   $started=Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRoot ".local\logs\$($definition.Name).out.log") -RedirectStandardError (Join-Path $taskRoot ".local\logs\$($definition.Name).err.log")
   $ready=$false
   for($i=0;$i -lt 40;$i++){try{$response=Invoke-WebRequest -UseBasicParsing -Uri $definition.Health -TimeoutSec 2;if($response.StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 250}
   if(!$ready){throw "$($definition.Name) did not become ready. Inspect its local log."}
  }
  Write-Output "$($definition.Name) ready: $($definition.Health)"
 }
}
if($Action -eq 'Status'){foreach($definition in $serviceDefinitions){$process=Get-ServiceOwner $definition;$healthy=$false;try{$healthy=(Invoke-WebRequest -UseBasicParsing -Uri $definition.Health -TimeoutSec 2).StatusCode -eq 200}catch{};[pscustomobject]@{Service=$definition.Name;Port=$definition.Port;ProcessId=$process.ProcessId;Healthy=$healthy}}}
