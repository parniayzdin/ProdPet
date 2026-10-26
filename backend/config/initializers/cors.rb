origins = [4173, 5173, 5174].flat_map do |port|
  ["http://localhost:#{port}", "http://127.0.0.1:#{port}"]
end
origins.concat(ENV.fetch("FRONTEND_ORIGIN", "").split(",").map(&:strip).reject(&:empty?))

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*origins)
    resource "*", headers: :any, methods: [:get, :post, :options], credentials: true
  end
end
