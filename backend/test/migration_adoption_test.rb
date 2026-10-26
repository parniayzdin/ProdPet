require "test_helper"
require "sqlite3"
require "tmpdir"
require "open3"

class MigrationAdoptionTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "migration preserves an existing Python SQLite database" do
    Dir.mktmpdir("prodpet-adoption") do |directory|
      database_path = File.join(directory, "legacy.db")
      db = SQLite3::Database.new(database_path)
      db.execute_batch <<~SQL
        CREATE TABLE sessions (
          id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
          task TEXT NOT NULL, date DATETIME NOT NULL,
          seconds INTEGER NOT NULL, duration INTEGER NOT NULL, mode VARCHAR(16) NOT NULL,
          base INTEGER NOT NULL, bonus INTEGER NOT NULL, total INTEGER NOT NULL,
          created_at DATETIME NOT NULL
        );
        CREATE TABLE activity_events (
          time DATETIME NOT NULL, session_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL, event_type VARCHAR(32) NOT NULL,
          focus_seconds INTEGER NOT NULL, points INTEGER NOT NULL,
          PRIMARY KEY (time, session_id)
        );
        CREATE TABLE presence_events (
          time DATETIME NOT NULL, id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL,
          session_id VARCHAR(36), present BOOLEAN NOT NULL, source VARCHAR(16) NOT NULL,
          PRIMARY KEY (time, id)
        );
      SQL
      id, user_id = SecureRandom.uuid, SecureRandom.uuid
      timestamp = "2026-10-26 15:00:00.000000"
      db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, user_id, "Existing session", timestamp, 900, 900, "focus", 150, 0, 150, timestamp])
      db.execute("INSERT INTO activity_events VALUES (?, ?, ?, ?, ?, ?)",
        [timestamp, id, user_id, "session_completed", 900, 150])
      db.execute("INSERT INTO presence_events VALUES (?, ?, ?, ?, ?, ?)",
        [timestamp, SecureRandom.uuid, user_id, id, 1, "vision"])
      before = %w[sessions activity_events presence_events].to_h do |table|
        [table, db.execute("SELECT * FROM #{table}")]
      end
      db.close

      environment = {
        "RAILS_ENV" => "development", "DATABASE_URL" => "sqlite3:#{database_path}",
        "SCHEMA" => File.join(directory, "schema.rb")
      }
      stdout, stderr, status = Open3.capture3(environment, RbConfig.ruby,
        "bin/rails", "db:migrate", chdir: Rails.root.to_s)
      assert status.success?, "#{stdout}\n#{stderr}"

      db = SQLite3::Database.new(database_path)
      before.each { |table, rows| assert_equal rows, db.execute("SELECT * FROM #{table}") }
      assert_equal 0, db.get_first_value("SELECT COUNT(*) FROM penalty_receipts")
      assert_equal 1, db.get_first_value("SELECT COUNT(*) FROM schema_migrations")
      db.close
    end
  end
end
