class FocusSession < ApplicationRecord
  self.table_name = "sessions"

  FOCUS_DURATIONS = [300, 900, 1500, 3000].freeze
  QUEST_BONUSES = { 300 => 25, 900 => 75, 1500 => 150 }.freeze
  CANONICAL_FIELDS = %w[user_id task date seconds duration mode].freeze
  OUTPUT_FIELDS = %w[id user_id task date seconds duration mode base bonus total].freeze

  validates :id, :user_id, format: { with: UUID_PATTERN }
  validates :task, length: { minimum: 1, maximum: 120 }
  validates :date, presence: true
  validates :mode, inclusion: { in: %w[focus quest] }
  validates :duration, :seconds, numericality: { only_integer: true }
  validate :valid_duration
  before_validation :calculate_score

  def api_json
    as_json(only: OUTPUT_FIELDS)
  end

  def same_submission?(other)
    CANONICAL_FIELDS.all? { |field| public_send(field) == other.public_send(field) }
  end

  private

  def valid_duration
    allowed = mode == "focus" ? FOCUS_DURATIONS : QUEST_BONUSES.keys
    errors.add(:duration, "is not allowed for this mode") unless allowed.include?(duration)
    unless seconds && duration && seconds.between?(60, duration)
      errors.add(:seconds, "must be between 60 and duration")
    end
  end

  def calculate_score
    return unless seconds && duration
    self.base = (seconds / 60) * 10
    self.bonus = 0
    self.bonus = QUEST_BONUSES.fetch(duration, 0) if mode == "quest" && seconds >= duration
    self.total = base + bonus
  end
end
