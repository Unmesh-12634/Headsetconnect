import subprocess
import os
import sys
import shutil

def build():
    print("====================================================")
    print("Starting HeadsetConnect Packaging Pipeline...")
    print("====================================================")

    # 1. Build the React frontend
    print("\n[STEP 1] Compiling React frontend...")
    frontend_dir = os.path.abspath("frontend")
    if not os.path.exists(frontend_dir):
        print("[ERROR] 'frontend' directory not found!")
        sys.exit(1)

    # Run npm install if node_modules doesn't exist
    if not os.path.exists(os.path.join(frontend_dir, "node_modules")):
        print("node_modules not found. Running npm install...")
        npm_install_res = subprocess.run("npm install", shell=True, cwd=frontend_dir)
        if npm_install_res.returncode != 0:
            print("[ERROR] npm install failed!")
            sys.exit(1)

    npm_build_res = subprocess.run("npm run build", shell=True, cwd=frontend_dir)
    if npm_build_res.returncode != 0:
        print("[ERROR] npm run build failed!")
        sys.exit(1)
    
    # Remove any copied HeadsetConnect.exe from dist folder to prevent circular/recursive PyInstaller inclusion
    dist_exe = os.path.join(frontend_dir, "dist", "HeadsetConnect.exe")
    if os.path.exists(dist_exe):
        print(f"Removing packaged executable from static dist folder: {dist_exe}")
        try:
            os.remove(dist_exe)
        except Exception as e:
            print(f"[WARNING] Could not remove {dist_exe}: {e}")
            
    print("[OK] React frontend compiled successfully!")

    # 2. Check for PyInstaller
    print("\n[STEP 2] Checking build dependencies...")
    try:
        import PyInstaller
        print("[OK] PyInstaller is already installed.")
    except ImportError:
        print("PyInstaller not found. Installing via pip...")
        pip_res = subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], shell=False)
        if pip_res.returncode != 0:
            print("[ERROR] Failed to install PyInstaller!")
            sys.exit(1)

    # 3. Compile Backend with PyInstaller
    print("\n[STEP 3] Running PyInstaller compiler...")
    backend_main = os.path.abspath(os.path.join("backend", "main.py"))
    if not os.path.exists(backend_main):
        print(f"[ERROR] Backend main script not found at {backend_main}!")
        sys.exit(1)

    # Compile as a single file executable (Option A)
    onefile = True
    pyinstaller_args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name=HeadsetConnect",
        # Include the frontend/dist static files inside the executable package (mounted under frontend/dist)
        "--add-data", f"{os.path.join('frontend', 'dist')}{os.pathsep}{os.path.join('frontend', 'dist')}",
        # Ensure all uvicorn and websockets dependencies are fully packaged
        "--hidden-import=fastapi",
        "--hidden-import=uvicorn",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.protocols.http.h11_impl",
        "--hidden-import=uvicorn.protocols.websockets",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.protocols.websockets.wsproto_impl",
        "--hidden-import=uvicorn.lifespan",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=uvicorn.lifespan.off",
        "--hidden-import=websockets",
        "--hidden-import=websockets.legacy",
        "--hidden-import=websockets.legacy.server",
        "--hidden-import=sounddevice",
        "--hidden-import=numpy",
        "--hidden-import=yt_dlp",
        "--hidden-import=pydub",
        "--hidden-import=pydub.audio_segment",
        "--hidden-import=static_ffmpeg",
    ]

    if onefile:
        pyinstaller_args.append("--onefile")
    else:
        pyinstaller_args.append("--onedir")

    pyinstaller_args.append(backend_main)

    print(f"Running command: {' '.join(pyinstaller_args)}")
    pyinst_res = subprocess.run(pyinstaller_args, shell=False)

    if pyinst_res.returncode != 0:
        print("[ERROR] PyInstaller build failed!")
        sys.exit(1)

    # 4. Zip the executable to bypass browser download warning triggers
    print("\n[STEP 4] Compiling ZIP archive to bypass browser warnings...")
    exe_path = os.path.abspath(os.path.join('dist', 'HeadsetConnect.exe'))
    zip_path = os.path.abspath(os.path.join('dist', 'HeadsetConnect-Windows.zip'))
    try:
        import zipfile
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(exe_path, 'HeadsetConnect.exe')
        print(f"[OK] Zip file created at: {zip_path}")
    except Exception as e:
        print(f"[ERROR] Failed to compile zip file: {e}")
        sys.exit(1)

    print("\n====================================================")
    print("SUCCESS: HeadsetConnect application packaged!")
    if onefile:
        print(f"Executable location: {exe_path}")
        print(f"Zip archive location: {zip_path}")
    else:
        print(f"Directory package location: {os.path.abspath('dist')}")
    print("====================================================")

if __name__ == "__main__":
    build()
