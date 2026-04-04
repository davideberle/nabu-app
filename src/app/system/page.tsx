import Link from "next/link";

const apiProviders = [
  {
    name: "Anthropic",
    description: "Claude API (via OpenClaw)",
    dashboardUrl: "https://console.anthropic.com/settings/billing",
  },
  {
    name: "OpenAI",
    description: "TTS for voice relay",
    dashboardUrl: "https://platform.openai.com/usage",
  },
  {
    name: "ElevenLabs",
    description: "STT for voice relay",
    dashboardUrl: "https://elevenlabs.io/app/subscription",
  },
  {
    name: "Vercel",
    description: "Companion app hosting",
    dashboardUrl: "https://vercel.com/davideberle/nabu-app",
  },
];

const services = [
  { name: "Voice Relay", status: "running", port: 8765, uptime: "2d 4h" },
  { name: "OpenClaw Gateway", status: "running", port: 3033, uptime: "5d 12h" },
  { name: "Music Assistant", status: "running", port: 8095, uptime: "3d 8h" },
  { name: "Sonos HTTP API", status: "running", port: 5005, uptime: "5d 12h" },
];

export default function SystemPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔧</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              System Status
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-3 text-left text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Service
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Port
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Uptime
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {services.map((service) => (
                <tr key={service.name}>
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100 font-medium">
                    {service.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      <span className="text-green-600 dark:text-green-400 text-sm">
                        {service.status}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 font-mono text-sm">
                    {service.port}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 text-sm">
                    {service.uptime}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* API Usage */}
        <div className="mt-6">
          <h3 className="font-medium text-zinc-900 dark:text-zinc-100 mb-3">
            API Usage
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {apiProviders.map((provider) => (
              <a
                key={provider.name}
                href={provider.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                  {provider.name}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {provider.description}
                </div>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-6 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
          <h3 className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            Mac mini
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Host:</span>{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                davidaeberle&apos;s Mac mini
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">OS:</span>{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                macOS Sequoia 15.3.1
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Node:</span>{" "}
              <span className="text-zinc-900 dark:text-zinc-100">v24.14.0</span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Tailscale:</span>{" "}
              <span className="text-green-600 dark:text-green-400">Connected</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
