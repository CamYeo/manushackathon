import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl, isOAuthConfigured } from "@/const";
import { ArrowRight, Mic, Brain, Users, Clock, BarChart3, Zap } from "lucide-react";
import { Fragment } from "react";
import { Link } from "wouter";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background border-b-4 border-foreground">
        <div className="container flex items-center justify-between h-20">
          <Link href="/" className="no-underline hover:bg-transparent">
            <span className="text-2xl font-black tracking-tighter uppercase">
              [DEBATE.ARENA]
            </span>
          </Link>
          <div className="flex items-center gap-6">
            {isAuthenticated ? (
              <>
                <Link href="/lobby" className="no-underline hover:bg-transparent">
                  <span className="font-bold uppercase tracking-wider hover:underline decoration-4 underline-offset-4">
                    Lobby
                  </span>
                </Link>
                <Link href="/room/create">
                  <Button className="brutalist-border brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-6 py-3 h-auto">
                    Start Debate
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </>
            ) : isOAuthConfigured ? (
              <a href={getLoginUrl()!}>
                <Button className="brutalist-border brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-6 py-3 h-auto">
                  Sign In
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </a>
            ) : (
              /* Local dev: no Manus OAuth, go straight to lobby as dev user */
              <Link href="/lobby">
                <Button className="brutalist-border brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-6 py-3 h-auto">
                  Enter (Dev Mode)
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-32">
        <div className="container">
          <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-12 lg:gap-16 items-end">
            <div className="space-y-8 min-w-0">
              <div className="space-y-4">
                <p className="text-lg md:text-xl font-bold uppercase tracking-widest text-muted-foreground">
                  AI-Powered Training
                </p>
                <h1 className="text-massive leading-none break-words">
                  DEBATE<br />
                  <span className="brutalist-underline">SMARTER</span>
                </h1>
              </div>
              <p className="text-xl md:text-2xl font-medium max-w-lg leading-relaxed">
                Real-time transcription. Argument analysis. 
                AI coaching. Scale your debate practice without limits.
              </p>
              <div className="flex flex-wrap gap-4">
                {isAuthenticated ? (
                  <Link href="/room/create">
                    <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-8 py-6 h-auto text-lg">
                      Create Room
                      <ArrowRight className="ml-3 h-6 w-6" />
                    </Button>
                  </Link>
                ) : isOAuthConfigured ? (
                  <a href={getLoginUrl()!}>
                    <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-8 py-6 h-auto text-lg">
                      Get Started
                      <ArrowRight className="ml-3 h-6 w-6" />
                    </Button>
                  </a>
                ) : (
                  <Link href="/lobby">
                    <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-8 py-6 h-auto text-lg">
                      Get Started (Dev)
                      <ArrowRight className="ml-3 h-6 w-6" />
                    </Button>
                  </Link>
                )}
                <Link href="/lobby">
                  <Button variant="outline" size="lg" className="brutalist-border bg-transparent uppercase font-black tracking-wider px-8 py-6 h-auto text-lg hover:bg-foreground hover:text-background transition-colors">
                    Join Room
                  </Button>
                </Link>
              </div>
            </div>
            <div className="hidden lg:block min-w-0 w-full lg:max-w-2xl xl:max-w-3xl justify-self-end">
              <div className="brutalist-border-thick brutalist-shadow-lg p-8 lg:p-10 xl:p-12 bg-background">
                <div className="space-y-4 lg:space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-4 h-4 lg:w-5 lg:h-5 bg-foreground"></div>
                    <span className="font-bold uppercase tracking-wider lg:text-lg xl:text-xl">Asian Parliamentary Format</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 lg:gap-6 pt-4">
                    <div className="brutalist-border p-4 lg:p-6 team-gov">
                      <p className="font-black uppercase text-sm lg:text-base xl:text-lg mb-2">Government</p>
                      <div className="space-y-1 text-sm lg:text-base">
                        <p>• Prime Minister</p>
                        <p>• Deputy PM</p>
                        <p>• Gov. Whip</p>
                      </div>
                    </div>
                    <div className="brutalist-border p-4 lg:p-6 team-opp">
                      <p className="font-black uppercase text-sm lg:text-base xl:text-lg mb-2">Opposition</p>
                      <div className="space-y-1 text-sm lg:text-base">
                        <p>• Leader of Opp.</p>
                        <p>• Deputy LO</p>
                        <p>• Opp. Whip</p>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 border-t-4 border-foreground">
                    <p className="text-6xl lg:text-7xl xl:text-8xl font-black leading-none">6</p>
                    <p className="font-bold uppercase tracking-wider text-muted-foreground lg:text-base xl:text-lg mt-2">Debaters per Room</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-foreground text-background">
        <div className="container">
          <div className="mb-16">
            <p className="text-lg font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Platform Features
            </p>
            <h2 className="text-display">
              EVERYTHING YOU NEED
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Mic,
                title: "Live Transcription",
                description: "Real-time speech-to-text with speaker identification and timestamp segmentation."
              },
              {
                icon: Brain,
                title: "AI Analysis",
                description: "Automatic argument extraction, clash detection, and quality scoring."
              },
              {
                icon: Users,
                title: "Team Rooms",
                description: "Support for 2 teams of 3 debaters with role-based speaker order."
              },
              {
                icon: Clock,
                title: "Auto Timekeeping",
                description: "Enforced speech times, protected periods, and POI management."
              },
              {
                icon: BarChart3,
                title: "Progress Tracking",
                description: "Track responsiveness, rebuttal quality, and improvement over time."
              },
              {
                icon: Zap,
                title: "Instant Feedback",
                description: "AI-generated post-debate analysis with actionable suggestions."
              }
            ].map((feature, index) => (
              <div 
                key={index}
                className="border-4 border-background p-8 hover:bg-background hover:text-foreground transition-colors group"
              >
                <feature.icon className="h-12 w-12 mb-6 group-hover:scale-110 transition-transform" />
                <h3 className="text-2xl font-black uppercase tracking-tight mb-4">
                  {feature.title}
                </h3>
                <p className="text-lg opacity-80 group-hover:opacity-100">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="container">
          <div className="mb-16">
            <p className="text-lg font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Simple Process
            </p>
            <h2 className="text-display">
              HOW IT WORKS
            </h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-8 lg:gap-6 items-stretch">
            {[
              { step: "01", title: "Create Room", desc: "Generate a debate room with AI motion" },
              { step: "02", title: "Join Teams", desc: "Debaters join as Gov or Opposition" },
              { step: "03", title: "Debate Live", desc: "Speak while AI transcribes in real-time" },
              { step: "04", title: "Get Feedback", desc: "Review argument map and AI analysis" }
            ].map((item, index) => (
              <Fragment key={index}>
                <div className="brutalist-border brutalist-shadow brutalist-shadow-hover transition-all p-6 bg-background h-full">
                  <span className="text-6xl font-black text-muted-foreground/30">
                    {item.step}
                  </span>
                  <h3 className="text-xl font-black uppercase mt-4 mb-2">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
                {index < 3 && (
                  <div className="flex items-center justify-center" aria-hidden="true">
                    <ArrowRight className="h-10 w-10 rotate-90 lg:rotate-0 shrink-0" strokeWidth={3} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 border-y-8 border-foreground">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "7", label: "Min Speech Time" },
              { value: "8", label: "Speakers Total" },
              { value: "∞", label: "AI Analysis" },
              { value: "0", label: "Setup Required" }
            ].map((stat, index) => (
              <div key={index}>
                <p className="text-6xl md:text-8xl font-black">{stat.value}</p>
                <p className="font-bold uppercase tracking-wider text-muted-foreground mt-2">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container">
          <div className="brutalist-border-thick brutalist-shadow-lg p-12 md:p-20 text-center">
            <h2 className="text-display mb-8">
              READY TO<br />
              <span className="brutalist-underline">LEVEL UP?</span>
            </h2>
            <p className="text-xl md:text-2xl max-w-2xl mx-auto mb-12 text-muted-foreground">
              Join debaters worldwide using AI to sharpen their argumentation skills.
            </p>
            {isAuthenticated ? (
              <Link href="/room/create">
                <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-12 py-8 h-auto text-xl">
                  Create Your First Room
                  <ArrowRight className="ml-4 h-8 w-8" />
                </Button>
              </Link>
            ) : isOAuthConfigured ? (
              <a href={getLoginUrl()!}>
                <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-12 py-8 h-auto text-xl">
                  Start Free
                  <ArrowRight className="ml-4 h-8 w-8" />
                </Button>
              </a>
            ) : (
              <Link href="/lobby">
                <Button size="lg" className="brutalist-border brutalist-shadow-lg brutalist-shadow-hover transition-all uppercase font-black tracking-wider px-12 py-8 h-auto text-xl">
                  Start Free (Dev)
                  <ArrowRight className="ml-4 h-8 w-8" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t-4 border-foreground">
        <div className="container">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tighter uppercase">
                [DEBATE.ARENA]
              </span>
              <span className="text-muted-foreground">
                — AI-Powered Debate Training
              </span>
            </div>
            <div className="flex items-center gap-8">
              <Link href="/lobby" className="font-bold uppercase tracking-wider text-sm hover:underline decoration-2 underline-offset-4 no-underline hover:bg-transparent">
                Lobby
              </Link>
              <Link href="/profile" className="font-bold uppercase tracking-wider text-sm hover:underline decoration-2 underline-offset-4 no-underline hover:bg-transparent">
                Profile
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
