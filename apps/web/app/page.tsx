import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Flag, GitBranch, Layers, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";

import { HomeFaq, HomeProductSections } from "@/components/home/product-sections";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: { absolute: "Flags by Iwifunni — release with confidence" },
  alternates: { canonical: "https://flags.iwifunni.cc" },
  openGraph: { title: "Flags by Iwifunni", description: "Feature management and progressive delivery. Ship the code. Release on your terms.", url: "https://flags.iwifunni.cc", siteName: "Flags by Iwifunni", type: "website" },
  description: "Separate deploys from releases. Manage feature flags, target the right users, and roll out changes gradually with Flags by Iwifunni.",
};

const features = [
  { icon: Flag, number: "01", title: "A switch for every feature.", description: "Turn features on or off without another deployment. Keep release decisions in your dashboard, close to the people making them." },
  { icon: Users, number: "02", title: "The right audience, first.", description: "Target users with rules and reusable segments. Give your team an early look before introducing a feature to everyone." },
  { icon: GitBranch, number: "03", title: "Small steps. Better releases.", description: "Roll out gradually across your environments. Start with a small percentage and expand when you’re ready." },
];

export default function HomePage() {
  return (
    <div className="overflow-x-clip bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4">Skip to content</a>
      <header className="border-b border-border bg-card">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-5 sm:px-6 lg:px-10">
          <Link href="/" aria-label="Flags by Iwifunni home" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Logo className="size-7 text-primary" /><span>Flags<span className="mt-0.5 block text-[10px] font-normal tracking-normal text-muted-foreground">by Iwifunni</span></span></Link>
          <div className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex"><a href="#features" className="hover:text-foreground">Features</a><a href="#workflow" className="hover:text-foreground">Workflow</a><a href="#faq" className="hover:text-foreground">FAQs</a></div>
          <div className="flex items-center gap-5 text-sm font-medium"><Link href="/sign-in" className="hover:text-primary">Sign in</Link><Link href="/sign-up" className="rounded-lg bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-primary/90">Get started <span aria-hidden="true">↗</span></Link></div>
        </nav>
      </header>
      <main id="main">
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-10 lg:py-28">
          <div>
            <p className="mb-7 flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-widest text-primary"><span className="size-2 rounded-full bg-primary" /> Flags by Iwifunni / Feature management</p>
            <h1 className="max-w-xl text-5xl leading-[1.08] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">Ship the code.<br />Release on <span className="text-primary">your terms.</span></h1>
            <p className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground">A deploy shouldn’t be a leap of faith. Control your features, choose your audience, and roll out at your own pace.</p>
            <div className="mt-9 flex flex-wrap items-center gap-6"><Link href="/sign-up" className="inline-flex items-center gap-3 rounded-lg bg-primary px-5 py-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Start building with confidence <ArrowRight className="size-4" /></Link><a href="#how-it-works" className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary">See how it works <ArrowDown className="size-4" /></a></div>
            <p className="mt-6 font-mono text-xs text-muted-foreground">Less release anxiety. More forward motion.</p>
          </div>
          <div className="relative min-w-0" aria-label="Illustrative feature flag dashboard">
            <div className="absolute -inset-5 -rotate-2 rounded-3xl bg-auth-panel sm:-inset-7" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-primary/5">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><span className="flex items-center gap-2 text-sm font-semibold"><Logo className="size-5 text-primary" />acme / storefront</span><span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] text-muted-foreground">Demo preview</span></div>
              <div className="p-5 sm:p-7">
                <div className="mb-7 flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">FEATURE FLAGS / 003</span><span className="flex items-center gap-1.5 text-xs text-ok-ink"><span className="size-1.5 rounded-full bg-success" /> Production</span></div>
                {[{ name: "New checkout", key: "new-checkout", active: true }, { name: "Instant search", key: "instant-search", active: true }, { name: "Holiday collection", key: "holiday-collection", active: false }].map((flag) => <div key={flag.key} className="flex items-center justify-between border-b border-border py-4"><div><p className="text-sm font-medium">{flag.name}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{flag.key}</p></div><span aria-label={flag.active ? "Enabled" : "Disabled"} className={`flex h-5 w-9 items-center rounded-full px-0.5 ${flag.active ? "justify-end bg-primary" : "bg-slate-300"}`}><span className="size-4 rounded-full bg-white shadow-sm" /></span></div>)}
                <div className="mt-6 rounded-lg border border-auth-panel-border bg-auth-panel p-4"><div className="flex items-center justify-between text-xs font-medium"><span className="flex items-center gap-2"><SlidersHorizontal className="size-3.5 text-primary" />New checkout rollout</span><span className="font-mono text-primary">25%</span></div><div className="my-4 h-2 overflow-hidden rounded-full bg-primary/10"><div className="h-full w-1/4 rounded-full bg-primary" /></div><p className="text-xs text-muted-foreground">Start small. Expand when you’re ready.</p></div>
              </div>
              <div className="flex items-center gap-2 border-t border-border px-5 py-3 font-mono text-[10px] text-muted-foreground"><Check className="size-3.5 text-ok-ink" /> Your next release is in your hands.</div>
            </div>
          </div>
        </section>
        <div className="border-y border-border bg-card"><div className="mx-auto grid max-w-7xl gap-5 px-6 py-6 text-sm text-muted-foreground sm:grid-cols-3 lg:px-10">{[{ icon: Layers, text: "Separate deploys from releases" }, { icon: Users, text: "Reach the right users" }, { icon: ShieldCheck, text: "Stay in control of every rollout" }].map(({ icon: Icon, text }) => <p key={text} className="flex items-center gap-3 sm:justify-center"><Icon className="size-4 shrink-0 text-primary" />{text}</p>)}</div></div>
        <section id="features" className="mx-auto max-w-7xl scroll-mt-8 px-6 py-20 lg:px-10 lg:py-24">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Make room for better releases</p><h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">Move fast. Keep your hands<br className="hidden sm:block" /> on the controls.</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">{features.map(({ icon: Icon, number, title, description }) => <article key={number} className="border-t border-border pt-6"><div className="mb-7 flex items-center justify-between"><Icon className="size-6 text-primary" /><span className="font-mono text-xs text-muted-foreground">/{number}</span></div><h3 className="text-lg font-semibold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p></article>)}</div>
        </section>
        <HomeProductSections />
        <section id="how-it-works" className="border-y border-border bg-card px-6 py-20 lg:px-10"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2"><div><p className="font-mono text-xs uppercase tracking-widest text-primary">From idea to rollout</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">One less thing between<br />you and your next release.</h2><Link href="/sign-up" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Create your workspace <ArrowRight className="size-4" /></Link></div><ol className="space-y-7">{[{ title: "Create a flag", text: "Give your feature a key and configure its variations." }, { title: "Connect your application", text: "Use an SDK to evaluate your flags where your code runs." }, { title: "Choose who gets it", text: "Set targeting rules and rollout percentages in your dashboard." }].map((step, index) => <li key={step.title} className="flex gap-5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-primary">{index + 1}</span><div><h3 className="font-medium">{step.title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p></div></li>)}</ol></div></section>
        <HomeFaq />
        <section className="mx-auto max-w-7xl px-6 py-20 text-center lg:px-10"><Logo className="mx-auto mb-5 size-9 text-primary" /><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your next release. Your call.</h2><p className="mt-4 text-muted-foreground">Give your features a more thoughtful way into the world.</p><Link href="/sign-up" className="mt-7 inline-flex items-center gap-3 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Get started with Flags <ArrowRight className="size-4" /></Link></section>
      </main>
      <footer className="border-t border-border px-6 py-7"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground"><Link href="/" className="flex items-center gap-2 font-semibold text-foreground"><Logo className="size-5 text-primary" />Flags by Iwifunni</Link><a href="https://flags.iwifunni.cc" className="font-mono hover:text-primary">flags.iwifunni.cc</a><Link href="/sign-in" className="hover:text-primary">Sign in <span aria-hidden="true">↗</span></Link></div></footer>
    </div>
  );
}
