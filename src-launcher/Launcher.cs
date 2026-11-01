using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;

namespace CookBookLauncher
{
    static class Program
    {
        private const string AppUrl = "http://127.0.0.1:3847";

        private static bool IsServerRunning()
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", 3847, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(200));
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindAppDir()
        {
            try
            {
                string exePath = Assembly.GetExecutingAssembly().Location;
                string dir = Path.GetDirectoryName(exePath);
                if (!string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "server.js")))
                {
                    return dir;
                }
            }
            catch { }
            return @"d:\Cooking App";
        }

        private static void StartNodeServer(string appDir)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "\"" + Path.Combine(appDir, "server.js") + "\"",
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch { }
        }

        private static void LaunchDesktopWindow()
        {
            string[] candidates = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            };

            foreach (string browser in candidates)
            {
                if (File.Exists(browser))
                {
                    try
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = browser,
                            Arguments = "--app=" + AppUrl + " --window-size=1400,920",
                            UseShellExecute = false
                        };
                        Process.Start(psi);
                        return;
                    }
                    catch { }
                }
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = AppUrl,
                    UseShellExecute = true
                });
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            string appDir = FindAppDir();
            if (!IsServerRunning())
            {
                StartNodeServer(appDir);
                for (int i = 0; i < 35; i++)
                {
                    if (IsServerRunning()) break;
                    Thread.Sleep(100);
                }
            }
            LaunchDesktopWindow();
        }
    }
}
