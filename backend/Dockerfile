FROM ruby:3.4-slim
RUN apt-get update && apt-get install --no-install-recommends -y build-essential libpq-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/Gemfile backend/Gemfile.lock ./
RUN bundle config set without 'test' && bundle config set frozen true && bundle install
COPY backend/ ./
RUN groupadd --system rails && useradd --system --gid rails rails \
    && mkdir -p storage tmp/pids log && chown -R rails:rails /app/backend
ENV RAILS_ENV=production PORT=8000
USER rails
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ruby -rnet/http -e 'exit(Net::HTTP.get_response(URI("http://127.0.0.1:8000/health")).code == "200" ? 0 : 1)'
CMD ["sh", "-c", "ruby bin/rails db:prepare && bundle exec puma -C config/puma.rb"]
