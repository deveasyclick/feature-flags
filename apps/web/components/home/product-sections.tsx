import { ArrowRight, Check, GitPullRequest, History, Layers, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

const questions = [
  { question: "How is a release different from a deployment?", answer: "A deployment puts code into your application. A flag lets you decide when that code becomes available and who can use it. Deploy first, then release to your team, a selected audience, or everyone." },
  { question: "Can each environment have different settings?", answer: "Yes. A flag can have separate configurations in development, staging, and production. Test a change in one environment before introducing it in another." },
  { question: "Are flags limited to on and off?", answer: "No. Flags supports boolean, string, number, and JSON values. Use a switch for feature access, or variations for configuration values your application needs." },
  { question: "How do I release to a specific group?", answer: "Define rules using user attributes, or build reusable segments for audiences you target often. Combine targeting with percentage rollouts to introduce a feature gradually." },
  { question: "Can production changes require a review?", answer: "Yes. Protected environments use change requests so a proposed configuration can be reviewed before it is applied. Flag history and the audit log help your team follow changes." },
  { question: "How are Flags and Iwifunni related?", answer: "Flags is the feature management and progressive delivery product by Iwifunni. Its home is flags.iwifunni.cc." },
];

export function HomeProductSections() {
  return (
    <>
      <section id="targeting" className="border-y border-border bg-card px-6 py-20 lg:px-10 lg:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">An audience, not a guess</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Your first users don’t<br />have to be everyone.</h2>
            <p className="mt-5 max-w-lg leading-7 text-muted-foreground">Start with the people who can help you learn. Give your internal team access, invite a beta group, then bring the experience to a wider audience.</p>
            <ul className="mt-7 space-y-4 text-sm">
              {["Target with attributes that matter to your application", "Reuse audience segments across your flags", "Combine rules with a gradual percentage rollout"].map((text) => (
                <li key={text} className="flex items-start gap-3"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{text}</li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><span className="flex items-center gap-2 text-sm font-medium"><Users className="size-4 text-primary" />Targeting rules</span><span className="font-mono text-[10px] text-muted-foreground">EXAMPLE</span></div>
            <div className="space-y-4 p-5 sm:p-7">
              <div className="rounded-lg border border-border bg-card p-5"><p className="font-mono text-xs text-primary">01 / INTERNAL PREVIEW</p><p className="mt-4 text-sm font-medium">User is in segment</p><p className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">internal-team</p><p className="mt-4 flex items-center gap-2 text-xs text-ok-ink"><ArrowRight className="size-3.5" />Serve Enabled</p></div>
              <div className="rounded-lg border border-border bg-card p-5"><p className="font-mono text-xs text-primary">02 / EARLY ACCESS</p><p className="mt-4 text-sm font-medium">plan equals pro</p><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>Percentage rollout</span><span className="font-mono text-primary">25%</span></div><div className="mt-3 h-2 rounded-full bg-muted"><div className="h-full w-1/4 rounded-full bg-primary" /></div></div>
              <p className="text-center text-xs text-muted-foreground">Everyone else receives the default variation.</p>
            </div>
          </div>
        </div>
      </section>
      <section id="environments" className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
        <div className="max-w-2xl"><p className="font-mono text-xs uppercase tracking-widest text-primary">A place for every stage</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Same feature.<br />Different levels of ready.</h2><p className="mt-5 leading-7 text-muted-foreground">Development needs room to explore. Staging needs a realistic rehearsal. Production needs a deliberate release. Give each environment its own flag configuration.</p></div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[{ name: "Development", label: "BUILD & EXPLORE", value: "100%", width: "w-full", description: "Keep the new experience available while you build and iterate." }, { name: "Staging", label: "TEST & REFINE", value: "100%", width: "w-full", description: "Exercise the feature with your team before its production release." }, { name: "Production", label: "INTRODUCE & EXPAND", value: "25%", width: "w-1/4", description: "Introduce the experience gradually, with a configuration of its own." }].map((environment) => (
            <article key={environment.name} className="rounded-xl border border-border bg-card p-6"><Layers className="size-5 text-primary" /><p className="mt-6 font-mono text-[10px] tracking-widest text-muted-foreground">{environment.label}</p><h3 className="mt-2 text-xl font-semibold">{environment.name}</h3><p className="mt-3 min-h-20 text-sm leading-7 text-muted-foreground">{environment.description}</p><div className="mt-6 border-t border-border pt-5"><div className="flex items-center justify-between font-mono text-xs"><span>new-checkout</span><span className="text-primary">{environment.value}</span></div><div className="mt-3 h-1.5 rounded-full bg-muted"><div className={`h-full rounded-full bg-primary ${environment.width}`} /></div></div></article>
          ))}
        </div>
        <p className="mt-4 font-mono text-[10px] text-muted-foreground">Illustrative configurations for a gradual release.</p>
      </section>
      <section id="workflow" className="bg-nav-bg px-6 py-20 text-white lg:px-10 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-20"><div><p className="font-mono text-xs uppercase tracking-widest text-blue-300">Built for the whole release</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">A good release takes<br />more than a toggle.</h2></div><p className="max-w-lg self-end leading-7 text-slate-300">Keep your team’s decisions close to the configuration. Review proposed changes, understand what happened, and keep access aligned with each person’s role.</p></div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">{[{ icon: GitPullRequest, title: "Review before release", text: "Protect an environment and use change requests to review configuration updates before they reach it." }, { icon: History, title: "Follow the changes", text: "Use flag history and the audit log to trace configuration changes and understand how a release evolved." }, { icon: ShieldCheck, title: "Give access deliberately", text: "Organize work into projects and use member roles to control who can read, configure, and manage your features." }].map(({ icon: Icon, title, text }) => <article key={title} className="border-t border-slate-600 pt-6"><Icon className="size-6 text-blue-300" /><h3 className="mt-5 text-lg font-medium">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-300">{text}</p></article>)}</div>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-2 lg:items-center lg:gap-20 lg:px-10 lg:py-24">
        <div><p className="font-mono text-xs uppercase tracking-widest text-primary">Configuration meets code</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Small switches.<br />Plenty of possibilities.</h2><p className="mt-5 leading-7 text-muted-foreground">Gate a new experience with a boolean, choose between string variations, or serve a number or JSON configuration. Keep the application logic in your code and the release configuration in Flags.</p><Link href="/sign-up" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Set up your first flag <ArrowRight className="size-4" /></Link></div>
        <dl className="divide-y divide-border rounded-xl border border-border bg-card px-6">{[{ type: "Boolean", example: "true", use: "Enable the new checkout" }, { type: "String", example: '"compact"', use: "Choose a navigation layout" }, { type: "Number", example: "12", use: "Configure a page size" }, { type: "JSON", example: '{ "theme": "spring" }', use: "Serve structured configuration" }].map((variation) => <div key={variation.type} className="grid grid-cols-[auto_1fr] items-center gap-3 py-6"><dt className="text-sm font-medium">{variation.type}</dt><dd className="justify-self-end rounded bg-muted px-2.5 py-1 font-mono text-xs text-primary">{variation.example}</dd><dd className="col-span-2 text-xs text-muted-foreground">{variation.use}</dd></div>)}</dl>
      </section>
    </>
  );
}

export function HomeFaq() {
  return (
    <section id="faq" className="border-y border-border bg-card px-6 py-20 lg:px-10 lg:py-24">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-20"><div><p className="font-mono text-xs uppercase tracking-widest text-primary">A few useful answers</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Before your<br />first release.</h2><p className="mt-5 max-w-sm leading-7 text-muted-foreground">Get to know how Flags fits into the way your team builds and ships.</p></div><div className="divide-y divide-border border-y border-border">{questions.map(({ question, answer }) => <details key={question} className="py-5"><summary className="cursor-pointer text-sm leading-6 font-medium marker:text-primary">{question}</summary><p className="mt-4 text-sm leading-7 text-muted-foreground">{answer}</p></details>)}</div></div>
    </section>
  );
}
