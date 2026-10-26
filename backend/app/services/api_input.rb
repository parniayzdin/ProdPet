class ApiInput
  class Invalid < StandardError; end

  def self.uuid(value, name)
    raise Invalid, "#{name} must be a UUID" unless value.is_a?(String) && ApplicationRecord::UUID_PATTERN.match?(value)
    value.downcase
  end

  def self.integer(value, name)
    raise Invalid, "#{name} must be an integer" unless value.is_a?(Integer)
    value
  end

  def self.text(value, name, minimum: 0, maximum:)
    unless value.is_a?(String) && value.length.between?(minimum, maximum)
      raise Invalid, "#{name} must be #{minimum}–#{maximum} characters"
    end
    value
  end

  def self.timestamp(value)
    unless value.is_a?(String) && /T.*(?:Z|[+-]\d{2}:\d{2})\z/i.match?(value)
      raise Invalid, "date must be ISO 8601 with a timezone (Z or an offset)"
    end
    Time.iso8601(value).utc
  rescue ArgumentError
    raise Invalid, "date must be a valid ISO 8601 timestamp"
  end
end
