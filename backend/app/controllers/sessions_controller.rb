class SessionsController < ApplicationController
  before_action :authorize_owner!, only: :index

  def create
    row = FocusSession.new(
      id: ApiInput.uuid(params[:id], "id"),
      user_id: @current_user_id,
      task: ApiInput.text(params[:task], "task", minimum: 1, maximum: 120),
      date: ApiInput.timestamp(params[:date]),
      seconds: ApiInput.integer(params[:seconds], "seconds"),
      duration: ApiInput.integer(params[:duration], "duration"),
      mode: params.fetch(:mode, "focus")
    )
    row.validate!
    existing = FocusSession.find_by(id: row.id)
    return replay(existing, row) if existing

    FocusSession.transaction do
      row.save!
      ActivityEvent.create!(time: row.date, session_id: row.id, user_id: row.user_id,
        event_type: "session_completed", focus_seconds: row.seconds, points: row.total)
    end
    render json: row.api_json, status: :created
  rescue ActiveRecord::RecordNotUnique
    existing = FocusSession.find_by(id: row.id)
    raise unless existing
    replay(existing, row)
  end

  def index
    render json: FocusSession.where(user_id: @current_user_id).order(date: :desc).map(&:api_json)
  end

  private

  def replay(existing, submitted)
    if existing.same_submission?(submitted)
      render json: existing.api_json
    else
      render json: { detail: "session id already exists with different data" }, status: :conflict
    end
  end
end
