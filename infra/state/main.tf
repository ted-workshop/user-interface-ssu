terraform {
  required_version = "~> 1.17.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28.1"
    }
  }
}

provider "cloudflare" {}

variable "account_id" {
  type = string
}

variable "state_bucket" {
  type    = string
  default = "qletter-terraform-state"
}

resource "cloudflare_r2_bucket" "state" {
  account_id = var.account_id
  name       = var.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}
