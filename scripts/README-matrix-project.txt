
  ███╗   ███╗ █████╗ ████████╗██████╗ ██╗██╗  ██╗
  ████╗ ████║██╔══██╗╚══██╔══╝██╔══██╗██║╚██╗██╔╝
  ██╔████╔██║███████║   ██║   ██████╔╝██║ ╚███╔╝
  ██║╚██╔╝██║██╔══██║   ██║   ██╔══██╗██║ ██╔██╗
  ██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║██║██╔╝ ██╗
  ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝

#NOTES:

# cp ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist .
# rm ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist 
⏺ Perfect! 🎉 Port 3000 is free and the launchd agent is gone. The serve process won't respawn anymore.
  Summary of the fix:                                                                                                                             
  1. The issue was a launchd agent (com.caribou.swarm-dashboard) with KeepAlive=true that was automatically restarting the serve process
  2. Created a disabled plist to override it                                                                                                      
  3. Ran launchctl unload ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist to permanently unload it
  The shutdown_matrix.sh script now includes the disabled plist creation, so future shutdowns will be cleaner. You're all set! 




#Install:
#Run:
#Clean:
cd ./node_modules/.cache



