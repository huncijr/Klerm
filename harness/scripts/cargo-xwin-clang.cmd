@echo off
if "%1"=="build" shift
set args=
:args_loop
if "%~1"=="" goto run
set args=%args% "%~1"
shift
goto args_loop
:run
cargo-xwin xwin build --cross-compiler clang %args%
