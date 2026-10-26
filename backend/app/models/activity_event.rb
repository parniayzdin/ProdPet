class ActivityEvent < ApplicationRecord
  self.primary_key = [:time, :session_id]
  scope :penalties, -> { where("event_type LIKE ?", "habit_penalty%") }
  scope :scored, -> { where("event_type = ? OR event_type LIKE ?", "session_completed", "habit_penalty%") }
end
