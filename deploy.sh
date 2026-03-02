#! deploy.sh

echo "🚀 Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
npm install --production

echo "🔧 Generating Prisma client..."
npx prisma generate

echo "🗄 Applying database migrations..."
npx prisma migrate deploy

echo "🏗 Building project..."
npm run build

echo "♻ Restarting PM2 process..."
pm2 restart Team-API

echo "💾 Saving PM2 state..."
pm2 save

echo "✅ Deployment complete."
