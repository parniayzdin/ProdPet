Rails.application.routes.draw do
  get "/health", to: "health#show"
  post "/sessions", to: "sessions#create"
  get "/users/:user_id/sessions", to: "sessions#index"
  get "/users/:user_id/stats", to: "stats#show"
  post "/penalties", to: "penalties#create"
  post "/presence", to: "presence#create"
  get "/users/:user_id/focus-quality", to: "presence#quality"
end
