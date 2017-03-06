# Using cygwin sh on windows by default
For using cygwin sh or any other sh complient shell, you need to make the symlink on bin directory with you sh.exe file.
If cygwin is installed in C:\\cygwin64: open cmd.exe with administrator privileges and type command

mklink /D C:\\bin C:\\cygwin64\bin

To make symlink from C:\\cygwin64\bin to C:\\bin. Now watcher will use C:\\bin\sh.exe as default shell for executing commands.