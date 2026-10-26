class ApplicationController < ActionController::API
  before_action :authenticate_user!
  rescue_from ApiInput::Invalid do |error|
    render json: { detail: error.message }, status: :unprocessable_entity
  end
  rescue_from ActiveRecord::RecordInvalid do |error|
    render json: { detail: error.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
  end
  rescue_from SupabaseAuth::Unauthorized do |error|
    render json: { detail: error.message }, status: :unauthorized
  end
  rescue_from SupabaseAuth::Unavailable do |error|
    render json: { detail: error.message }, status: :service_unavailable
  end

  private

  def authenticate_user!
    match = /\ABearer\s+(\S+)\z/i.match(request.headers["Authorization"].to_s)
    raise SupabaseAuth::Unauthorized, "Missing bearer token" unless match
    @current_user_id = SupabaseAuth.user_id(match[1])
  end

  def authorize_owner!
    user_id = ApiInput.uuid(params[:user_id], "user_id")
    render json: { detail: "forbidden" }, status: :forbidden if user_id != @current_user_id
  end
end
