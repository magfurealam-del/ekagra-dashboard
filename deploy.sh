#!/bin/bash
# Ekagra Health Dashboard — One-Command Vercel Deployment
# -------------------------------------------------------
# Prerequisites: Node.js 18+, Vercel CLI (npx vercel)
# Run: chmod +x deploy.sh && ./deploy.sh

set -e
echo "🏥 Ekagra Health Dashboard — Deploying to Vercel"
echo "================================================="

# Check for service role key
if grep -q "YOUR_SERVICE_ROLE_KEY_HERE" .env.local; then
  echo ""
  echo "⚠️  ACTION REQUIRED:"
  echo "   1. Go to: https://supabase.com/dashboard/project/youqgrwovfyqqsnbtcnm/settings/api"
  echo "   2. Copy the 'service_role' key (secret key)"  
  echo "   3. Edit .env.local and replace YOUR_SERVICE_ROLE_KEY_HERE"
  echo ""
  read -p "Press Enter when done..."
fi

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔨 Building project..."
npm run build

echo ""
echo "🚀 Deploying to Vercel (team: ekagra-dhanmondi)..."
echo "   Project ID: prj_xUiwPlNikkpOYNYcewnT0ZWRseNa"
echo ""

# Set environment variables and deploy
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --force <<< "https://youqgrwovfyqqsnbtcnm.supabase.co"
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --force <<< "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXFncndvdmZ5cXFzbmJ0Y25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzA1NjYsImV4cCI6MjA5NzYwNjU2Nn0.DDT_QztGEchnhdmOoC1ADH6chXYuZgk9MnxxExa93Vw"
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --force <<< "$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2)"

npx vercel --prod --yes

echo ""
echo "✅ Deployment complete!"
