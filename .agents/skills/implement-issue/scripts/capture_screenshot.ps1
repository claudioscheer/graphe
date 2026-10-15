param(
    [Parameter(Mandatory=$true)]
    [string]$OutputPath,

    [string]$ProcessName = "graphe",
    [int]$WaitMs = 1500
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$code = @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class WindowSnapshot {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBmp, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static IntPtr FindMainWindow(uint pid) {
        IntPtr bestHwnd = IntPtr.Zero;
        int maxArea = 0;

        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            uint p;
            GetWindowThreadProcessId(hWnd, out p);
            if (p == pid) {
                RECT r;
                if (GetWindowRect(hWnd, out r)) {
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    int area = w * h;
                    if (area > maxArea && w > 50 && h > 50) {
                        maxArea = area;
                        bestHwnd = hWnd;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);

        return bestHwnd;
    }

    public static Bitmap CaptureWindow(IntPtr hWnd) {
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) return null;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;

        Bitmap bmp = new Bitmap(width, height);
        using (Graphics g = Graphics.FromImage(bmp)) {
            bool captured = false;
            try {
                // CopyFromScreen captures GPU/DirectX swapchain rendering accurately
                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
                captured = true;
            } catch {
                // In non-interactive sessions or locked displays, CopyFromScreen throws "The handle is invalid"
            }

            if (!captured) {
                IntPtr hdc = g.GetHdc();
                try {
                    // PW_RENDERFULLCONTENT = 2
                    bool ok = PrintWindow(hWnd, hdc, 2);
                    if (!ok) {
                        PrintWindow(hWnd, hdc, 0);
                    }
                } finally {
                    g.ReleaseHdc(hdc);
                }
            }
        }
        return bmp;
    }
}
"@

Add-Type -TypeDefinition $code -ReferencedAssemblies "System.Drawing", "System.Windows.Forms"

$parentDir = Split-Path -Parent $OutputPath
if ($parentDir -and -not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

Start-Sleep -Milliseconds $WaitMs

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1

if ($proc) {
    # FindMainWindow locates the actual visible GUI window, bypassing winit's 6x6 hidden helper window
    $hwnd = [WindowSnapshot]::FindMainWindow([uint32]$proc.Id)
    if ($hwnd -eq [IntPtr]::Zero -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $hwnd = $proc.MainWindowHandle
    }

    if ($hwnd -ne [IntPtr]::Zero) {
        [WindowSnapshot]::ShowWindow($hwnd, 9) | Out-Null # SW_RESTORE
        [WindowSnapshot]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 400

        $bmp = [WindowSnapshot]::CaptureWindow($hwnd)
        if ($bmp) {
            $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            Write-Output "Window screenshot saved to $OutputPath"
            exit 0
        }
    }
}

Write-Warning "Could not find window for process '$ProcessName'. Ensure '$ProcessName' is running."
exit 1
