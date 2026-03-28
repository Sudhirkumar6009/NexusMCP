'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Zap, 
  GitBranch, 
  Shield, 
  ArrowRight, 
  Play,
  Check,
  Sparkles,
  Workflow,
  Database,
  MessageSquare,
  Github,
  Moon,
  Sun
} from 'lucide-react';

export default function LandingPage() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(prefersDark);
    if (prefersDark) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <div className="min-h-screen bg-surface-primary">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-surface-primary/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-content-primary">NexusMCP</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-content-secondary hover:text-content-primary transition-colors">
              Features
            </a>
            <a href="#integrations" className="text-content-secondary hover:text-content-primary transition-colors">
              Integrations
            </a>
            <a href="#pricing" className="text-content-secondary hover:text-content-primary transition-colors">
              Pricing
            </a>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
            >
              {isDark ? <Sun className="w-5 h-5 text-content-secondary" /> : <Moon className="w-5 h-5 text-content-secondary" />}
            </button>
            <Link 
              href="/login" 
              className="text-content-secondary hover:text-content-primary transition-colors"
            >
              Sign in
            </Link>
            <Link 
              href="/login"
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
              <Sparkles className="w-4 h-4" />
              <span>AI-Powered Workflow Automation</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-content-primary mb-6 leading-tight">
              Orchestrate APIs with
              <span className="text-primary"> Intelligence</span>
            </h1>
            
            <p className="text-xl text-content-secondary mb-10 max-w-2xl mx-auto leading-relaxed">
              NexusMCP connects your tools through the Model Context Protocol, 
              enabling autonomous multi-step workflows powered by AI agents.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link 
                href="/login"
                className="w-full sm:w-auto px-8 py-4 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all font-medium text-lg flex items-center justify-center gap-2 shadow-lg shadow-primary/25"
              >
                Start for Free
                <ArrowRight className="w-5 h-5" />
              </Link>
              <button className="w-full sm:w-auto px-8 py-4 border border-border rounded-xl hover:bg-surface-secondary transition-all font-medium text-lg flex items-center justify-center gap-2 text-content-primary">
                <Play className="w-5 h-5" />
                Watch Demo
              </button>
            </div>
          </div>

          {/* Hero Visual */}
          <div className="mt-20 relative">
            <div className="absolute inset-0 bg-gradient-to-t from-surface-primary via-transparent to-transparent z-10 pointer-events-none" />
            <div className="relative rounded-2xl border border-border bg-surface-secondary p-2 shadow-2xl">
              <div className="rounded-xl bg-surface-primary overflow-hidden">
                {/* Mock Dashboard Preview */}
                <div className="h-[500px] p-6 flex gap-6">
                  {/* Sidebar */}
                  <div className="w-56 shrink-0 rounded-xl bg-surface-secondary p-4 space-y-2">
                    {['Dashboard', 'Integrations', 'Workflows', 'Logs'].map((item, i) => (
                      <div 
                        key={item}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium ${
                          i === 0 ? 'bg-primary text-white' : 'text-content-secondary'
                        }`}
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                  
                  {/* Main Content */}
                  <div className="flex-1 space-y-6">
                    {/* DAG Preview */}
                    <div className="h-full rounded-xl border border-border bg-surface-secondary/50 p-6 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-4">
                        {/* Trigger Node */}
                        <div className="px-6 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-500 font-medium flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          Slack Trigger
                        </div>
                        <div className="w-px h-8 bg-border" />
                        {/* Action Node */}
                        <div className="px-6 py-3 rounded-xl bg-primary/10 border border-primary/30 text-primary font-medium flex items-center gap-2">
                          <GitBranch className="w-4 h-4" />
                          Create Jira Issue
                        </div>
                        <div className="w-px h-8 bg-border" />
                        {/* Output Node */}
                        <div className="px-6 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-500 font-medium flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          Store in Database
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-surface-secondary">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-content-primary mb-4">
              Everything you need to automate
            </h2>
            <p className="text-xl text-content-secondary max-w-2xl mx-auto">
              Build complex workflows with natural language, visualize them as DAGs, 
              and execute with full observability.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Sparkles,
                title: 'Natural Language Workflows',
                description: 'Describe what you want to automate in plain English. Our AI generates the workflow DAG automatically.',
                color: 'text-purple-500',
                bg: 'bg-purple-500/10'
              },
              {
                icon: Workflow,
                title: 'Visual DAG Editor',
                description: 'Interactive drag-and-drop editor to customize your workflows. See the data flow between each step.',
                color: 'text-primary',
                bg: 'bg-primary/10'
              },
              {
                icon: Shield,
                title: 'Approval Gates',
                description: 'Add human-in-the-loop checkpoints for critical operations. Full control over autonomous execution.',
                color: 'text-green-500',
                bg: 'bg-green-500/10'
              }
            ].map((feature) => (
              <div 
                key={feature.title}
                className="p-8 rounded-2xl bg-surface-primary border border-border hover:border-primary/30 transition-all group"
              >
                <div className={`w-14 h-14 rounded-xl ${feature.bg} flex items-center justify-center mb-6`}>
                  <feature.icon className={`w-7 h-7 ${feature.color}`} />
                </div>
                <h3 className="text-xl font-semibold text-content-primary mb-3">
                  {feature.title}
                </h3>
                <p className="text-content-secondary leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations Section */}
      <section id="integrations" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-content-primary mb-4">
              Connect your favorite tools
            </h2>
            <p className="text-xl text-content-secondary max-w-2xl mx-auto">
              Seamlessly integrate with popular services through the Model Context Protocol.
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { name: 'Jira', icon: '📋', description: 'Project Management' },
              { name: 'Slack', icon: '💬', description: 'Communication' },
              { name: 'GitHub', icon: '🐙', description: 'Version Control' },
              { name: 'PostgreSQL', icon: '🐘', description: 'Database' }
            ].map((integration) => (
              <div 
                key={integration.name}
                className="p-6 rounded-2xl bg-surface-secondary border border-border hover:border-primary/30 transition-all text-center group cursor-pointer"
              >
                <div className="text-4xl mb-4">{integration.icon}</div>
                <h3 className="text-lg font-semibold text-content-primary mb-1">
                  {integration.name}
                </h3>
                <p className="text-sm text-content-secondary">
                  {integration.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6 bg-surface-secondary">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-content-primary mb-4">
              Simple, transparent pricing
            </h2>
            <p className="text-xl text-content-secondary max-w-2xl mx-auto">
              Start free, scale as you grow. No hidden fees.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: 'Starter',
                price: 'Free',
                description: 'Perfect for trying out NexusMCP',
                features: ['5 workflows', '100 executions/month', '2 integrations', 'Community support'],
                cta: 'Get Started',
                highlighted: false
              },
              {
                name: 'Pro',
                price: '$29',
                period: '/month',
                description: 'For growing teams and projects',
                features: ['Unlimited workflows', '10,000 executions/month', 'All integrations', 'Priority support', 'Custom approval gates'],
                cta: 'Start Free Trial',
                highlighted: true
              },
              {
                name: 'Enterprise',
                price: 'Custom',
                description: 'For large organizations',
                features: ['Unlimited everything', 'On-premise deployment', 'SLA guarantee', 'Dedicated support', 'Custom integrations'],
                cta: 'Contact Sales',
                highlighted: false
              }
            ].map((plan) => (
              <div 
                key={plan.name}
                className={`p-8 rounded-2xl border ${
                  plan.highlighted 
                    ? 'bg-primary border-primary text-white scale-105 shadow-xl shadow-primary/25' 
                    : 'bg-surface-primary border-border'
                }`}
              >
                <h3 className={`text-xl font-semibold mb-2 ${plan.highlighted ? 'text-white' : 'text-content-primary'}`}>
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className={`text-4xl font-bold ${plan.highlighted ? 'text-white' : 'text-content-primary'}`}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={plan.highlighted ? 'text-white/70' : 'text-content-secondary'}>
                      {plan.period}
                    </span>
                  )}
                </div>
                <p className={`mb-6 ${plan.highlighted ? 'text-white/70' : 'text-content-secondary'}`}>
                  {plan.description}
                </p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className={`w-5 h-5 ${plan.highlighted ? 'text-white' : 'text-green-500'}`} />
                      <span className={plan.highlighted ? 'text-white/90' : 'text-content-secondary'}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/login"
                  className={`block w-full py-3 rounded-xl font-medium text-center transition-colors ${
                    plan.highlighted
                      ? 'bg-white text-primary hover:bg-white/90'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-content-primary mb-6">
            Ready to automate your workflows?
          </h2>
          <p className="text-xl text-content-secondary mb-10 max-w-2xl mx-auto">
            Join thousands of teams using NexusMCP to connect their tools and automate complex processes.
          </p>
          <Link 
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all font-medium text-lg shadow-lg shadow-primary/25"
          >
            Get Started for Free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-semibold text-content-primary">NexusMCP</span>
            </div>
            <div className="flex items-center gap-6 text-content-secondary">
              <a href="#" className="hover:text-content-primary transition-colors">Privacy</a>
              <a href="#" className="hover:text-content-primary transition-colors">Terms</a>
              <a href="#" className="hover:text-content-primary transition-colors">Docs</a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-content-primary transition-colors">
                <Github className="w-5 h-5" />
              </a>
            </div>
            <p className="text-content-secondary text-sm">
              &copy; 2024 NexusMCP. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
