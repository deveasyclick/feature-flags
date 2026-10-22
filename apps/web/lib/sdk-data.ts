/**
 * SDK install and usage snippets.
 *
 * These are documentation, not API data: only `@iwifunni-flag/core` exists today, so
 * the rest are the shape each SDK is meant to ship with and are maintained here
 * until the packages publish their own. The connection values the screen pairs
 * them with — key, endpoints — come from the API, via
 * `environments.get(...).connection`.
 *
 * Every snippet shows the same three steps: initialize with an SDK key, identify
 * the subject targeting reads, then evaluate. The key is a runtime credential:
 * it reads one environment's configuration and can write nothing.
 */

export type SdkKey =
  | "node"
  | "python"
  | "go"
  | "react"
  | "java"
  | "ruby"
  | "php"
  | "dotnet";

/** Where a SDK evaluates flags: on a server, or in the browser. */
export type EvaluationScope = "Server-side" | "Client-side";

export interface SdkSnippet {
  /** Shell command that installs the package. */
  install: string;
  /** Creating the client, initializing it, and identifying the subject. */
  initialize: string;
  /** Reading one flag. */
  evaluate: string;
}

export interface SdkOption {
  key: SdkKey;
  label: string;
  /** Shown in the Connection panel; drives which key the SDK needs. */
  scope: EvaluationScope;
  steps: SdkSnippet;
}

const sdkOptions: SdkOption[] = [
  {
    key: "node",
    label: "Node.js",
    scope: "Server-side",
    steps: {
      install: "npm install @iwifunni-flag/core  # not on npm yet — link it from the workspace",
      initialize: `import { FeatureFlags } from "@iwifunni-flag/core";

const flags = new FeatureFlags({
  sdkKey: process.env.IWIFUNNI_SDK_KEY,
  telemetry: true,
  streaming: true,
  environment: "production",
});

// Downloads the configuration, then evaluates locally.
await flags.initialize();

flags.identify({
  userId: "123",
  attributes: { plan: "pro", country: "NL" },
});`,
      evaluate: `if (flags.isOn("checkout-v2")) renderNewCheckout();

const maxItems = flags.getNumber("max-items", 10);`,
    },
  },
  {
    key: "python",
    label: "Python",
    scope: "Server-side",
    steps: {
      install: "pip install iwifunni",
      initialize: `from iwifunni import FeatureFlags

flags = FeatureFlags(
    sdk_key=os.environ["IWIFUNNI_SDK_KEY"],
    environment="production",
)
flags.initialize()

flags.identify(user_id="123", attributes={"plan": "pro"})`,
      evaluate: `if flags.is_on("checkout-v2"):
    render_new_checkout()

max_items = flags.get_number("max-items", 10)`,
    },
  },
  {
    key: "go",
    label: "Go",
    scope: "Server-side",
    steps: {
      install: "go get github.com/iwifunni/iwifunni-go",
      initialize: `flags, err := featureflags.New(featureflags.Config{
    SDKKey:      os.Getenv("IWIFUNNI_SDK_KEY"),
    Environment: "production",
})
if err != nil {
    log.Fatal(err)
}

if err := flags.Initialize(); err != nil {
    log.Fatal(err)
}`,
      evaluate: `if flags.IsOn("checkout-v2", nil) {
    renderNewCheckout()
}

maxItems := flags.GetNumber("max-items", 10)`,
    },
  },
  {
    key: "react",
    label: "React",
    scope: "Client-side",
    steps: {
      install: "npm install @iwifunni/react",
      initialize: `import { FeatureFlagsProvider } from "@iwifunni/react";

<FeatureFlagsProvider
  sdkKey={process.env.NEXT_PUBLIC_IWIFUNNI_SDK_KEY}
  environment="production"
>
  <App />
</FeatureFlagsProvider>`,
      evaluate: `const on = useFlag("checkout-v2", false);

return on ? <NewCheckout /> : <Checkout />;`,
    },
  },
  {
    key: "java",
    label: "Java",
    scope: "Server-side",
    steps: {
      install: `implementation("dev.iwifunni:iwifunni-java:1.0.0")`,
      initialize: `FeatureFlags flags = FeatureFlags.builder()
    .sdkKey(System.getenv("IWIFUNNI_SDK_KEY"))
    .environment("production")
    .build();

flags.initialize();
flags.identify("123", Map.of("plan", "pro"));`,
      evaluate: `if (flags.isOn("checkout-v2")) {
    renderNewCheckout();
}

int maxItems = flags.getNumber("max-items", 10);`,
    },
  },
  {
    key: "ruby",
    label: "Ruby",
    scope: "Server-side",
    steps: {
      install: "gem install iwifunni",
      initialize: `require "iwifunni"

flags = Iwifunni::FeatureFlags.new(
  sdk_key: ENV["IWIFUNNI_SDK_KEY"],
  environment: "production",
)
flags.initialize

flags.identify(user_id: "123", attributes: { plan: "pro" })`,
      evaluate: `render_new_checkout if flags.is_on("checkout-v2")

max_items = flags.get_number("max-items", 10)`,
    },
  },
  {
    key: "php",
    label: "PHP",
    scope: "Server-side",
    steps: {
      install: "composer require iwifunni/iwifunni",
      initialize: `use Iwifunni\\FeatureFlags;

$flags = new FeatureFlags(
    getenv("IWIFUNNI_SDK_KEY"),
    "production",
);
$flags->initialize();

$flags->identify("123", ["plan" => "pro"]);`,
      evaluate: `if ($flags->isOn("checkout-v2")) {
    renderNewCheckout();
}

$maxItems = $flags->getNumber("max-items", 10);`,
    },
  },
  {
    key: "dotnet",
    label: ".NET",
    scope: "Server-side",
    steps: {
      install: "dotnet add package Iwifunni",
      initialize: `using Iwifunni;

var flags = new FeatureFlags(new FeatureFlagsOptions
{
    SdkKey = Environment.GetEnvironmentVariable("IWIFUNNI_SDK_KEY"),
    Environment = "production",
});

await flags.InitializeAsync();
flags.Identify("123", new Dictionary<string, object> { ["plan"] = "pro" });`,
      evaluate: `if (flags.IsOn("checkout-v2"))
{
    RenderNewCheckout();
}

var maxItems = flags.GetNumber("max-items", 10);`,
    },
  },
];

/** The SDK the screen opens on, matching the design. */
export const defaultSdkKey: SdkKey = "node";

/** Every SDK the screen offers, in the order the picker lists them. */
export function getSdkOptions(): SdkOption[] {
  return sdkOptions.filter((sdk) => sdk.key === "node");
}
